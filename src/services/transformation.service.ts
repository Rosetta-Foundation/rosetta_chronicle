import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import {
  DerivedRecord,
  DerivedSourceRef,
  ProvenanceQuery,
  ProvenanceResult,
  TransformRecordInput,
  TransformRecordResult,
  TransformationDefinition,
  TransformationExecution,
  TransformationRecipe,
} from '../types';
import type { IChatGptGraphStore } from '../repositories/chatgpt-graph-store.repository';
import type { IDerivedRecordStore } from '../repositories/derived-record-store.repository';
import type { ITransformationDefinitionStore } from '../repositories/transformation-definition-store.repository';
import type { ITransformationExecutionStore } from '../repositories/transformation-execution-store.repository';
import type { ITransformationRegistry } from '../repositories/transformation-registry.repository';
import {
  buildDerivedRecord,
  defaultReviewState,
  validateDerivedDraft,
  validateSourceRefsOnGraph,
} from '../utils/derived-record.utils';
import {
  buildTransformationDefinition,
  buildTransformationExecution,
  diffExecutions,
  validateTransformationDraft,
} from '../utils/transformation.utils';

/**
 * Orchestrates named transformations and execution-provenance walks.
 *
 * Creates derived records through a registered recipe and persists an
 * immutable execution beside them. Does not summarize, emit Activity,
 * or write Daily Chronicles. Directories are caller configuration.
 */
export interface ITransformationService {
  transform(input: TransformRecordInput): Promise<TransformRecordResult>;
  provenance(query: ProvenanceQuery): Promise<ProvenanceResult>;
}

/**
 * Transformation implementation of {@link ITransformationService}.
 *
 * Depends only on repositories (registry, definition store, execution
 * store, derived store, optional graph store). Re-run of the same
 * identity is a no-op and keeps the original `createdAt`.
 */
@injectable()
export class TransformationService implements ITransformationService {
  constructor(
    @inject(CHRONICLE_TOKENS.TransformationRegistry)
    private readonly _registry: ITransformationRegistry,
    @inject(CHRONICLE_TOKENS.TransformationDefinitionStore)
    private readonly _definitionStore: ITransformationDefinitionStore,
    @inject(CHRONICLE_TOKENS.TransformationExecutionStore)
    private readonly _executionStore: ITransformationExecutionStore,
    @inject(CHRONICLE_TOKENS.DerivedRecordStore)
    private readonly _recordStore: IDerivedRecordStore,
    @inject(CHRONICLE_TOKENS.ChatGptGraphStore)
    private readonly _graphStore: IChatGptGraphStore,
  ) {}

  /** @inheritDoc */
  async transform(
    input: TransformRecordInput,
  ): Promise<TransformRecordResult> {
    const draftErrors = [
      ...validateDerivedDraft({
        sourceGraphHash: input.sourceGraphHash,
        nodeIds: input.nodeIds,
        transformationType: input.transformationType,
        createdBy: input.createdBy,
        content: input.content,
        confidence: input.confidence,
      }),
      ...validateTransformationDraft({
        sourceGraphHash: input.sourceGraphHash,
        transformationVersion: input.transformationVersion,
        configuration: input.configuration,
      }),
    ];
    if (draftErrors.length > 0) {
      return this.invalid(draftErrors.join(', '));
    }

    const recipe = this._registry.get(
      input.transformationType,
      input.transformationVersion,
    );
    if (!recipe) {
      return this.invalid(
        `unknown-transformation:${input.transformationType}@${input.transformationVersion}`,
      );
    }
    if (!recipe.allowedProducerTypes.includes(input.createdBy.type)) {
      return this.invalid(
        `producer-not-allowed:${input.createdBy.type}`,
      );
    }

    const sourceRefs = [this.sourceRef(input)];
    if (input.graphPath) {
      const graph = await this._graphStore.readAt(input.graphPath);
      if (!graph) {
        return this.invalid(`source-graph-unreadable:${input.graphPath}`);
      }
      const refErrors = validateSourceRefsOnGraph(graph, sourceRefs[0]);
      if (refErrors.length > 0) {
        return this.invalid(refErrors.join(', '));
      }
    }

    const createdAt = input.createdAt ?? new Date().toISOString();
    const reviewState =
      input.reviewState ?? defaultReviewState(input.createdBy.type);
    const definition = await this.persistDefinition(
      input.definitionsDir,
      recipe,
      createdAt,
      input.dryRun === true,
    );
    const contents = [input.content, ...(input.extraContents ?? [])];
    const drafts = contents.map((content) =>
      buildDerivedRecord({
        sourceRefs,
        transformationType: input.transformationType,
        createdBy: input.createdBy,
        content,
        createdAt,
        confidence: input.confidence,
        reviewState,
      }),
    );
    const execution = buildTransformationExecution({
      definitionId: definition.id,
      transformationType: input.transformationType,
      transformationVersion: input.transformationVersion,
      sourceRefs,
      producer: input.createdBy,
      createdAt,
      configuration: input.configuration ?? {},
      deterministic: recipe.deterministic,
      outputRefs: drafts.map((record) => record.id),
      outputContentRefs: drafts.map((record) => record.contentRef),
    });
    const records = drafts.map((record) => ({
      ...record,
      executionId: execution.id,
    }));

    const existing = await this._executionStore.read(
      input.executionsDir,
      execution.id,
    );
    if (existing && existing.id === execution.id) {
      return this.toResult(
        'already-present',
        existing,
        definition,
        records,
        input,
      );
    }
    if (input.dryRun) {
      return this.toResult(
        'recorded',
        execution,
        definition,
        records,
        input,
      );
    }
    for (const record of records) {
      const prior = await this._recordStore.read(input.outputDir, record.id);
      if (!prior) {
        await this._recordStore.write(input.outputDir, record);
      }
    }
    await this._executionStore.write(input.executionsDir, execution);
    return this.toResult(
      'recorded',
      execution,
      definition,
      records,
      input,
    );
  }

  /** @inheritDoc */
  async provenance(query: ProvenanceQuery): Promise<ProvenanceResult> {
    const modes = [
      query.derivedId,
      query.executionId,
      query.sourceGraphHash,
      query.compareId,
      query.definitionId,
    ].filter((value) => value != null && value !== '');
    if (modes.length !== 1) {
      return {
        status: 'invalid',
        error: 'provenance-mode-ambiguous',
      };
    }
    if (query.derivedId) return this.fromDerived(query);
    if (query.executionId) return this.fromExecution(query);
    if (query.sourceGraphHash) return this.fromSource(query);
    if (query.definitionId) return this.fromDefinition(query);
    return this.compare(query);
  }

  private async fromDerived(
    query: ProvenanceQuery,
  ): Promise<ProvenanceResult> {
    const derivedId = query.derivedId as string;
    let execution: TransformationExecution | null = null;
    if (query.outputDir) {
      const record = await this._recordStore.read(
        query.outputDir,
        derivedId,
      );
      if (record?.executionId) {
        execution = await this._executionStore.read(
          query.executionsDir,
          record.executionId,
        );
      }
    }
    if (!execution) {
      const listed = await this._executionStore.list(query.executionsDir);
      execution =
        listed.find((row) => row.outputRefs.includes(derivedId)) ?? null;
    }
    if (!execution) {
      return { status: 'not-found', derivedId, error: 'execution-missing' };
    }
    return this.withDefinition(query, {
      status: 'ok',
      derivedId,
      executionId: execution.id,
      definitionId: execution.definitionId,
      sourceRefs: execution.sourceRefs,
      derivedIds: execution.outputRefs,
      execution,
    });
  }

  private async fromExecution(
    query: ProvenanceQuery,
  ): Promise<ProvenanceResult> {
    const execution = await this._executionStore.read(
      query.executionsDir,
      query.executionId as string,
    );
    if (!execution) {
      return {
        status: 'not-found',
        executionId: query.executionId,
        error: 'execution-missing',
      };
    }
    return this.withDefinition(query, {
      status: 'ok',
      executionId: execution.id,
      definitionId: execution.definitionId,
      sourceRefs: execution.sourceRefs,
      derivedIds: execution.outputRefs,
      execution,
    });
  }

  private async fromSource(
    query: ProvenanceQuery,
  ): Promise<ProvenanceResult> {
    const hash = query.sourceGraphHash as string;
    const listed = await this._executionStore.list(query.executionsDir);
    const matched = listed.filter((row) =>
      row.sourceRefs.some((ref) => ref.sourceGraphHash === hash),
    );
    return {
      status: 'ok',
      sourceRefs: [{ sourceGraphHash: hash, nodeIds: [] }],
      executionIds: matched.map((row) => row.id),
      derivedIds: matched.flatMap((row) => row.outputRefs),
    };
  }

  private async fromDefinition(
    query: ProvenanceQuery,
  ): Promise<ProvenanceResult> {
    const definitionId = query.definitionId as string;
    let definition: TransformationDefinition | undefined;
    if (query.definitionsDir) {
      const loaded = await this._definitionStore.read(
        query.definitionsDir,
        definitionId,
      );
      definition = loaded ?? undefined;
    }
    const listed = await this._executionStore.list(query.executionsDir);
    const matched = listed.filter((row) => row.definitionId === definitionId);
    if (!definition && matched.length === 0) {
      return {
        status: 'not-found',
        definitionId,
        error: 'definition-missing',
      };
    }
    return {
      status: 'ok',
      definitionId,
      definition,
      executionIds: matched.map((row) => row.id),
      derivedIds: matched.flatMap((row) => row.outputRefs),
    };
  }

  private async compare(query: ProvenanceQuery): Promise<ProvenanceResult> {
    if (!query.withId) {
      return { status: 'invalid', error: 'compare-with-missing' };
    }
    const left = await this._executionStore.read(
      query.executionsDir,
      query.compareId as string,
    );
    const right = await this._executionStore.read(
      query.executionsDir,
      query.withId,
    );
    if (!left || !right) {
      return { status: 'not-found', error: 'execution-missing' };
    }
    return {
      status: 'ok',
      executionIds: [left.id, right.id],
      difference: diffExecutions(left, right),
    };
  }

  private async persistDefinition(
    definitionsDir: string,
    recipe: TransformationRecipe,
    createdAt: string,
    dryRun: boolean,
  ): Promise<TransformationDefinition> {
    const draft = buildTransformationDefinition(recipe, createdAt);
    const existing = await this._definitionStore.read(
      definitionsDir,
      draft.id,
    );
    if (existing) return existing;
    if (!dryRun) {
      await this._definitionStore.write(definitionsDir, draft);
    }
    return draft;
  }

  private async withDefinition(
    query: ProvenanceQuery,
    result: ProvenanceResult,
  ): Promise<ProvenanceResult> {
    if (!query.definitionsDir || !result.definitionId) return result;
    const definition = await this._definitionStore.read(
      query.definitionsDir,
      result.definitionId,
    );
    return definition ? { ...result, definition } : result;
  }

  private sourceRef(input: TransformRecordInput): DerivedSourceRef {
    return {
      sourceGraphHash: input.sourceGraphHash,
      ...(input.conversationId
        ? { conversationId: input.conversationId }
        : {}),
      nodeIds: [...input.nodeIds],
    };
  }

  private invalid(error: string): TransformRecordResult {
    return { status: 'invalid', error };
  }

  private toResult(
    status: 'recorded' | 'already-present',
    execution: TransformationExecution,
    definition: TransformationDefinition,
    records: DerivedRecord[],
    input: TransformRecordInput,
  ): TransformRecordResult {
    return {
      status,
      executionId: execution.id,
      executionPath: this._executionStore.pathFor(
        input.executionsDir,
        execution.id,
      ),
      definitionId: definition.id,
      definitionPath: this._definitionStore.pathFor(
        input.definitionsDir,
        definition.id,
      ),
      derivedIds: records.map((record) => record.id),
      derivedPaths: records.map((record) =>
        this._recordStore.pathFor(input.outputDir, record.id),
      ),
      createdAt: execution.createdAt,
    };
  }
}
