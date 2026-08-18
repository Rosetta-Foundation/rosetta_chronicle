import { randomBytes } from 'crypto';
import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import {
  CandidateObservationPayload,
  DerivedProducer,
  DerivedRecord,
  DerivedSourceRef,
  ExecutionOccurrence,
  InterpretSourceInput,
  InterpretSourceResult,
  InterpretSourceStatus,
  ResolvedSourceNode,
  TransformationDefinition,
  TransformationExecution,
} from '../types';
import type { IChatGptGraphStore } from '../repositories/chatgpt-graph-store.repository';
import type { IDerivedRecordStore } from '../repositories/derived-record-store.repository';
import type { IExecutionOccurrenceStore } from '../repositories/execution-occurrence-store.repository';
import type { IModelInvocationRepository } from '../repositories/model-invocation.repository';
import type { ISourceContentRepository } from '../repositories/source-content.repository';
import type { ITransformationDefinitionStore } from '../repositories/transformation-definition-store.repository';
import type { ITransformationExecutionStore } from '../repositories/transformation-execution-store.repository';
import type { ITransformationRegistry } from '../repositories/transformation-registry.repository';
import {
  epistemicClassOf,
  parseCandidateObservationOutput,
  serializeCandidateObservation,
} from '../utils/candidate-observation.utils';
import {
  buildDerivedRecord,
  validateSourceRefsOnGraph,
} from '../utils/derived-record.utils';
import {
  CANDIDATE_OBSERVATION_POLICY,
  CANDIDATE_OBSERVATION_TYPE,
  INTERPRET_PRODUCER_NAME,
  expandCandidateObservationPrompt,
} from '../utils/interpretation-policy.utils';
import { buildExecutionOccurrence } from '../utils/occurrence.utils';
import {
  buildTransformationDefinition,
  buildTransformationExecution,
} from '../utils/transformation.utils';

/**
 * Orchestrates machine interpretation with provenance.
 *
 * Resolves private source ephemerally, invokes a model, and publishes
 * derived records only after the execution file is durable. Does not
 * emit Activity or write Daily Chronicles. Does not call other services.
 */
export interface IInterpretationService {
  interpret(input: InterpretSourceInput): Promise<InterpretSourceResult>;
}

/**
 * Interpretation implementation of {@link IInterpretationService}.
 *
 * Publication order for a live attempt:
 * definition → provider call → execution → derived → occurrence.
 * Occurrence `startedAt` / `nonce` default immediately before invoke.
 * Dry-run validates and hashes in memory only.
 */
@injectable()
export class InterpretationService implements IInterpretationService {
  constructor(
    @inject(CHRONICLE_TOKENS.TransformationRegistry)
    private readonly _registry: ITransformationRegistry,
    @inject(CHRONICLE_TOKENS.TransformationDefinitionStore)
    private readonly _definitionStore: ITransformationDefinitionStore,
    @inject(CHRONICLE_TOKENS.TransformationExecutionStore)
    private readonly _executionStore: ITransformationExecutionStore,
    @inject(CHRONICLE_TOKENS.DerivedRecordStore)
    private readonly _recordStore: IDerivedRecordStore,
    @inject(CHRONICLE_TOKENS.ExecutionOccurrenceStore)
    private readonly _occurrenceStore: IExecutionOccurrenceStore,
    @inject(CHRONICLE_TOKENS.ChatGptGraphStore)
    private readonly _graphStore: IChatGptGraphStore,
    @inject(CHRONICLE_TOKENS.SourceContentRepository)
    private readonly _sourceContent: ISourceContentRepository,
    @inject(CHRONICLE_TOKENS.ModelInvocationRepository)
    private readonly _model: IModelInvocationRepository,
  ) {}

  /** @inheritDoc */
  async interpret(
    input: InterpretSourceInput,
  ): Promise<InterpretSourceResult> {
    const preflight = await this.preflight(input);
    if ('error' in preflight) {
      return { status: 'invalid', error: preflight.error };
    }
    const { definition, sourceRefs, nodes } = preflight;
    if (input.dryRun === true) {
      return {
        status: 'dry-run',
        definitionId: definition.id,
        resolvedNodeCount: nodes.length,
      };
    }

    try {
      await this.persistDefinition(input.definitionsDir, definition);
    } catch (err) {
      return {
        status: 'persist-failed',
        definitionId: definition.id,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const producer: DerivedProducer = {
      type: 'agent',
      name: INTERPRET_PRODUCER_NAME,
      model: input.model,
    };
    const configuration = this.configuration(input);
    const prompt = expandCandidateObservationPrompt(nodes);
    // Occurrence identity: clocks of this physical provider call.
    const startedAt = input.startedAt ?? new Date().toISOString();
    const nonce = input.nonce ?? randomBytes(16).toString('hex');
    const modelResult = await this._model.invoke({
      provider: input.provider,
      model: input.model,
      prompt,
      ...(input.temperature != null
        ? { temperature: input.temperature }
        : {}),
    });
    const endedAt = input.endedAt ?? new Date().toISOString();

    if (!modelResult.ok) {
      return this.finishOccurrence({
        input,
        definition,
        sourceRefs,
        producer,
        configuration,
        startedAt,
        endedAt,
        nonce,
        providerStatus:
          modelResult.failureClass === 'timeout' ? 'uncertain' : 'failed',
        persistenceStatus: 'not-committed',
        providerFailureClass: modelResult.failureClass,
        status:
          modelResult.failureClass === 'timeout'
            ? 'uncertain'
            : modelResult.failureClass === 'unavailable'
              ? 'unavailable'
              : modelResult.failureClass === 'refused'
                ? 'refused'
                : 'invalid-output',
        error: `provider:${modelResult.failureClass}`,
        providerRequestId: undefined,
        modelVersion: undefined,
      });
    }

    const parsed = parseCandidateObservationOutput(
      modelResult.text,
      input.nodeIds,
    );
    if ('error' in parsed) {
      return this.finishOccurrence({
        input,
        definition,
        sourceRefs,
        producer,
        configuration,
        startedAt,
        endedAt,
        nonce,
        providerStatus: 'failed',
        persistenceStatus: 'not-committed',
        providerFailureClass: 'invalid-output',
        status: 'invalid-output',
        error: parsed.error,
        providerRequestId: modelResult.providerRequestId,
        modelVersion: modelResult.modelVersion,
      });
    }

    const createdAt = input.createdAt ?? new Date().toISOString();
    const drafts = parsed.payloads.map((payload) =>
      this.draftRecord(sourceRefs, producer, payload, createdAt),
    );
    const execution = buildTransformationExecution({
      definitionId: definition.id,
      transformationType: CANDIDATE_OBSERVATION_TYPE,
      transformationVersion: definition.version,
      sourceRefs,
      producer,
      createdAt,
      configuration,
      deterministic: false,
      outputRefs: drafts.map((record) => record.id),
      outputContentRefs: drafts.map((record) => record.contentRef),
    });
    const records = drafts.map((record) => ({
      ...record,
      executionId: execution.id,
    }));
    const outcome =
      parsed.payloads[0]?.result === 'insufficient-evidence'
        ? ('insufficient-evidence' as const)
        : ('observations' as const);

    const persisted = await this.publish(input, execution, records);
    if (!persisted.ok) {
      return this.finishOccurrence({
        input,
        definition,
        sourceRefs,
        producer,
        configuration,
        startedAt,
        endedAt,
        nonce,
        providerStatus: 'succeeded',
        persistenceStatus: 'not-committed',
        persistenceFailureClass: 'persist-failed',
        outcome,
        status: 'persist-failed',
        error: persisted.error,
        providerRequestId: modelResult.providerRequestId,
        modelVersion: modelResult.modelVersion,
      });
    }

    const existing = persisted.alreadyPresent;
    return this.finishOccurrence({
      input,
      definition,
      sourceRefs,
      producer,
      configuration,
      startedAt,
      endedAt,
      nonce,
      providerStatus: 'succeeded',
      persistenceStatus: 'committed',
      outcome,
      status: existing ? 'already-present' : 'recorded',
      executionId: execution.id,
      derivedIds: records.map((record) => record.id),
      observationCount: records.length,
      epistemicClasses: parsed.payloads.map(epistemicClassOf),
      reviewState: 'unreviewed',
      providerRequestId: modelResult.providerRequestId,
      modelVersion: modelResult.modelVersion,
    });
  }

  private async preflight(input: InterpretSourceInput): Promise<
    | {
        definition: TransformationDefinition;
        sourceRefs: DerivedSourceRef[];
        nodes: ResolvedSourceNode[];
      }
    | { error: string }
  > {
    if (!input.conversationId) {
      return { error: 'conversation-id-missing' };
    }
    if (input.nodeIds.length === 0) {
      return { error: 'node-ids-missing' };
    }
    if (input.nodeIds.some((id) => !id)) {
      return { error: 'node-id-empty' };
    }
    if (!input.provider.trim()) return { error: 'provider-missing' };
    if (!input.model.trim()) return { error: 'agent-model-missing' };

    const recipe = this._registry.get(CANDIDATE_OBSERVATION_TYPE, '1');
    if (!recipe?.policy) {
      return { error: 'unknown-transformation:candidate-observation@1' };
    }
    const createdAt = input.createdAt ?? new Date().toISOString();
    const definition = buildTransformationDefinition(recipe, createdAt);

    const graph = await this._graphStore.readAt(input.graphPath);
    if (!graph) {
      return { error: `source-graph-unreadable:${input.graphPath}` };
    }
    const sourceRefs: DerivedSourceRef[] = [
      {
        sourceGraphHash: input.sourceGraphHash,
        conversationId: input.conversationId,
        nodeIds: [...input.nodeIds],
      },
    ];
    const refErrors = validateSourceRefsOnGraph(graph, sourceRefs[0]);
    if (refErrors.length > 0) {
      return { error: refErrors.join(', ') };
    }

    const resolved = await this._sourceContent.resolve({
      exportPath: input.exportPath,
      sourceGraphHash: input.sourceGraphHash,
      conversationId: input.conversationId,
      nodeIds: input.nodeIds,
      graph,
    });
    if (!resolved.ok) return { error: resolved.error };
    return { definition, sourceRefs, nodes: resolved.nodes };
  }

  private configuration(
    input: InterpretSourceInput,
  ): Record<string, unknown> {
    return {
      provider: input.provider,
      ...(input.temperature != null
        ? { temperature: input.temperature }
        : {}),
      outputSchemaId: CANDIDATE_OBSERVATION_POLICY.outputSchemaId,
      promptTemplateId: CANDIDATE_OBSERVATION_POLICY.promptTemplateId,
      promptTemplateHash: CANDIDATE_OBSERVATION_POLICY.promptTemplateHash,
    };
  }

  private draftRecord(
    sourceRefs: DerivedSourceRef[],
    producer: DerivedProducer,
    payload: CandidateObservationPayload,
    createdAt: string,
  ): DerivedRecord {
    return buildDerivedRecord({
      sourceRefs,
      transformationType: CANDIDATE_OBSERVATION_TYPE,
      createdBy: producer,
      content: serializeCandidateObservation(payload),
      createdAt,
      reviewState: 'unreviewed',
    });
  }

  /**
   * Publish execution first, then derived records. A durable derived
   * file is accepted Chronicle memory and must not precede its execution.
   */
  private async publish(
    input: InterpretSourceInput,
    execution: TransformationExecution,
    records: DerivedRecord[],
  ): Promise<
    { ok: true; alreadyPresent: boolean } | { ok: false; error: string }
  > {
    try {
      const prior = await this._executionStore.read(
        input.executionsDir,
        execution.id,
      );
      const alreadyPresent = prior != null && prior.id === execution.id;
      if (!alreadyPresent) {
        await this._executionStore.write(input.executionsDir, execution);
      }
      const loaded = await this._executionStore.read(
        input.executionsDir,
        execution.id,
      );
      if (!loaded) {
        return { ok: false, error: 'execution-persist-unreadable' };
      }
      for (const record of records) {
        const existing = await this._recordStore.read(
          input.outputDir,
          record.id,
        );
        if (!existing) {
          await this._recordStore.write(input.outputDir, record);
        }
      }
      for (const record of records) {
        const written = await this._recordStore.read(
          input.outputDir,
          record.id,
        );
        if (!written) {
          return { ok: false, error: `derived-persist-unreadable:${record.id}` };
        }
      }
      return { ok: true, alreadyPresent };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async persistDefinition(
    definitionsDir: string,
    definition: TransformationDefinition,
  ): Promise<void> {
    const existing = await this._definitionStore.read(
      definitionsDir,
      definition.id,
    );
    if (existing) return;
    await this._definitionStore.write(definitionsDir, definition);
  }

  private async finishOccurrence(input: {
    input: InterpretSourceInput;
    definition: TransformationDefinition;
    sourceRefs: DerivedSourceRef[];
    producer: DerivedProducer;
    configuration: Record<string, unknown>;
    startedAt: string;
    endedAt: string;
    nonce: string;
    providerStatus: ExecutionOccurrence['providerStatus'];
    persistenceStatus: ExecutionOccurrence['persistenceStatus'];
    outcome?: ExecutionOccurrence['outcome'];
    providerFailureClass?: ExecutionOccurrence['providerFailureClass'];
    persistenceFailureClass?: 'persist-failed';
    status: InterpretSourceStatus;
    error?: string;
    executionId?: string;
    derivedIds?: string[];
    observationCount?: number;
    epistemicClasses?: string[];
    reviewState?: InterpretSourceResult['reviewState'];
    providerRequestId?: string;
    modelVersion?: string;
  }): Promise<InterpretSourceResult> {
    const occurrence = buildExecutionOccurrence({
      definitionId: input.definition.id,
      sourceRefs: input.sourceRefs,
      producer: input.producer,
      configuration: input.configuration,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      nonce: input.nonce,
      providerStatus: input.providerStatus,
      persistenceStatus: input.persistenceStatus,
      outcome: input.outcome,
      providerFailureClass: input.providerFailureClass,
      persistenceFailureClass: input.persistenceFailureClass,
      executionId: input.executionId,
      derivedIds: input.derivedIds,
      providerRequestId: input.providerRequestId,
      modelVersion: input.modelVersion,
    });
    try {
      await this._occurrenceStore.write(
        input.input.occurrencesDir,
        occurrence,
      );
    } catch {
      const interpretationCommitted =
        input.persistenceStatus === 'committed';
      return {
        status: interpretationCommitted
          ? 'occurrence-persist-failed'
          : input.status,
        definitionId: input.definition.id,
        executionId: input.executionId,
        derivedIds: input.derivedIds,
        providerStatus: input.providerStatus,
        persistenceStatus: input.persistenceStatus,
        outcome: input.outcome,
        observationCount: input.observationCount,
        epistemicClasses: input.epistemicClasses,
        reviewState: input.reviewState,
        error: interpretationCommitted
          ? 'occurrence-persist-failed'
          : (input.error ?? 'occurrence-persist-failed'),
      };
    }
    return {
      status: input.status,
      definitionId: input.definition.id,
      executionId: input.executionId,
      derivedIds: input.derivedIds,
      occurrenceId: occurrence.id,
      providerStatus: input.providerStatus,
      persistenceStatus: input.persistenceStatus,
      outcome: input.outcome,
      observationCount: input.observationCount,
      epistemicClasses: input.epistemicClasses,
      reviewState: input.reviewState,
      ...(input.error ? { error: input.error } : {}),
    };
  }
}
