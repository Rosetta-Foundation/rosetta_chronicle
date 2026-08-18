import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import {
  ChatGptSourceGraph,
  DerivedRecord,
  ProvenanceFailure,
  ProvenanceNode,
  ProvenanceRef,
  ProvenanceTraverseInput,
  ProvenanceTraverseResult,
  TransformationExecution,
} from '../types';
import type { IChatGptGraphStore } from '../repositories/chatgpt-graph-store.repository';
import type { IDerivedRecordStore } from '../repositories/derived-record-store.repository';
import type { ITransformationDefinitionStore } from '../repositories/transformation-definition-store.repository';
import type { ITransformationExecutionStore } from '../repositories/transformation-execution-store.repository';
import {
  ARCHIVE_REF,
  buildProvenanceEdges,
  collectPaths,
  conversationRef,
  nodeRef,
  refKey,
  sameRef,
  sortNodes,
  uniqueFailures,
} from '../utils/provenance-graph.utils';

/**
 * First-class provenance graph traversal.
 *
 * Builds an in-memory view over existing stores and walks it backward
 * or forward. Does not persist a separate edge index, emit Activity, or
 * write Daily Chronicles. Status and failures describe the requested
 * subgraph only — a broken cite elsewhere in the store is ignored.
 */
export interface IProvenanceService {
  traverse(input: ProvenanceTraverseInput): Promise<ProvenanceTraverseResult>;
}

/**
 * Provenance implementation of {@link IProvenanceService}.
 *
 * Depends only on repositories. Transformation-produced and directly
 * authored derived records both participate; an execution is not
 * required for lineage.
 */
@injectable()
export class ProvenanceService implements IProvenanceService {
  constructor(
    @inject(CHRONICLE_TOKENS.DerivedRecordStore)
    private readonly _recordStore: IDerivedRecordStore,
    @inject(CHRONICLE_TOKENS.TransformationExecutionStore)
    private readonly _executionStore: ITransformationExecutionStore,
    @inject(CHRONICLE_TOKENS.TransformationDefinitionStore)
    private readonly _definitionStore: ITransformationDefinitionStore,
    @inject(CHRONICLE_TOKENS.ChatGptGraphStore)
    private readonly _graphStore: IChatGptGraphStore,
  ) {}

  /** @inheritDoc */
  async traverse(
    input: ProvenanceTraverseInput,
  ): Promise<ProvenanceTraverseResult> {
    const dirError = this.missingDir(input);
    if (dirError) {
      return {
        status: 'invalid',
        start: input.start,
        direction: input.direction,
        nodes: [],
        edges: [],
        paths: [],
        failures: [],
        error: dirError,
      };
    }

    const derived = await this._recordStore.list(input.outputDir);
    const executions = await this._executionStore.list(input.executionsDir);
    const startOk = await this.startExists(input, derived, executions);
    if (!startOk) {
      return {
        status: 'not-found',
        start: input.start,
        direction: input.direction,
        nodes: [],
        edges: [],
        paths: [],
        failures: [],
        error: 'start-missing',
      };
    }

    const graphs = new Map<string, ChatGptSourceGraph>();
    const failures: ProvenanceFailure[] = [];
    const attempted = new Set<string>();
    let edges = buildProvenanceEdges({
      executions,
      derived,
      graphs,
    });
    let paths = collectPaths(input.start, input.direction, edges, []);
    let reachable = this.reachable(input.start, paths);

    // Load only graphs that appear on this walk so a broken archive
    // elsewhere in the store cannot mark a healthy subgraph partial.
    // A second pass adds contains edges once a cited archive resolves.
    for (;;) {
      await this.loadReachableGraphs(
        input.graphsDir,
        reachable,
        graphs,
        attempted,
        failures,
      );
      const next = buildProvenanceEdges({ executions, derived, graphs });
      const walkFailures: ProvenanceFailure[] = [];
      const nextPaths = collectPaths(
        input.start,
        input.direction,
        next,
        walkFailures,
      );
      const nextReachable = this.reachable(input.start, nextPaths);
      const grew =
        nextReachable.length !== reachable.length ||
        nextReachable.some(
          (ref) => !reachable.some((seen) => sameRef(seen, ref)),
        );
      edges = next;
      paths = nextPaths;
      reachable = nextReachable;
      if (!grew) {
        failures.push(...walkFailures);
        break;
      }
    }

    await this.auditCitations(input, reachable, failures);

    const nodes = sortNodes(this.resolveNodes(reachable, graphs, failures));
    const unique = uniqueFailures(failures);
    return {
      status: unique.length > 0 ? 'partial' : 'ok',
      start: input.start,
      direction: input.direction,
      nodes,
      edges: edges.filter(
        (item) =>
          reachable.some((ref) => sameRef(ref, item.from)) &&
          reachable.some((ref) => sameRef(ref, item.to)),
      ),
      paths,
      failures: unique,
    };
  }

  private missingDir(input: ProvenanceTraverseInput): string | undefined {
    if (!input.outputDir) return 'derived-dir-required';
    if (!input.executionsDir) return 'executions-dir-required';
    if (!input.definitionsDir) return 'definitions-dir-required';
    if (!input.graphsDir) return 'graphs-dir-required';
    return undefined;
  }

  private async startExists(
    input: ProvenanceTraverseInput,
    derived: DerivedRecord[],
    executions: TransformationExecution[],
  ): Promise<boolean> {
    const { start } = input;
    if (start.kind === 'derived-record') {
      return (await this._recordStore.read(input.outputDir, start.id)) != null;
    }
    if (start.kind === 'transformation-execution') {
      return (
        (await this._executionStore.read(input.executionsDir, start.id)) !=
        null
      );
    }
    if (start.kind === 'transformation-definition') {
      return (
        (await this._definitionStore.read(input.definitionsDir, start.id)) !=
        null
      );
    }
    if (start.kind === 'source-archive') {
      const graph = await this._graphStore.read(input.graphsDir, start.id);
      if (graph) return true;
      return this.hashIsCited(start.id, derived, executions);
    }
    const hash = start.id.slice(0, 64);
    const graph = await this._graphStore.read(input.graphsDir, hash);
    if (!graph) return false;
    if (start.kind === 'source-conversation') {
      const conversationId = start.id.slice(65);
      return graph.conversations.some((c) => c.sourceId === conversationId);
    }
    const rest = start.id.slice(65);
    const split = rest.indexOf(':');
    const conversationId = rest.slice(0, split);
    const nodeId = rest.slice(split + 1);
    const conv = graph.conversations.find((c) => c.sourceId === conversationId);
    return conv?.nodes.some((n) => n.id === nodeId) === true;
  }

  private hashIsCited(
    hash: string,
    derived: DerivedRecord[],
    executions: TransformationExecution[],
  ): boolean {
    const cites = (refs: { sourceGraphHash: string }[]) =>
      refs.some((ref) => ref.sourceGraphHash === hash);
    return (
      executions.some((row) => cites(row.sourceRefs)) ||
      derived.some((row) => cites(row.sourceRefs))
    );
  }

  private hashesFrom(refs: ProvenanceRef[]): string[] {
    const hashes = new Set<string>();
    for (const ref of refs) {
      if (ref.kind.startsWith('source-')) hashes.add(ref.id.slice(0, 64));
    }
    return [...hashes].sort();
  }

  private async loadReachableGraphs(
    graphsDir: string,
    refs: ProvenanceRef[],
    graphs: Map<string, ChatGptSourceGraph>,
    attempted: Set<string>,
    failures: ProvenanceFailure[],
  ): Promise<void> {
    for (const hash of this.hashesFrom(refs)) {
      if (attempted.has(hash)) continue;
      attempted.add(hash);
      const graph = await this._graphStore.read(graphsDir, hash);
      if (graph) {
        graphs.set(hash, graph);
        continue;
      }
      const diagnosis = await this._graphStore.diagnose(graphsDir, hash);
      failures.push({
        code:
          diagnosis === 'missing'
            ? 'source-graph-missing'
            : 'source-graph-invalid',
        ref: ARCHIVE_REF(hash),
      });
    }
  }

  private reachable(
    start: ProvenanceRef,
    paths: { nodes: ProvenanceRef[] }[],
  ): ProvenanceRef[] {
    const found = new Map<string, ProvenanceRef>();
    const add = (ref: ProvenanceRef) => found.set(refKey(ref), ref);
    add(start);
    for (const path of paths) {
      for (const ref of path.nodes) add(ref);
    }
    return [...found.values()];
  }

  private async auditCitations(
    input: ProvenanceTraverseInput,
    reachable: ProvenanceRef[],
    failures: ProvenanceFailure[],
  ): Promise<void> {
    for (const ref of reachable) {
      if (ref.kind === 'transformation-definition') {
        const loaded = await this._definitionStore.read(
          input.definitionsDir,
          ref.id,
        );
        if (loaded) continue;
        const diagnosis = await this._definitionStore.diagnose(
          input.definitionsDir,
          ref.id,
        );
        failures.push({
          code:
            diagnosis === 'missing'
              ? 'definition-missing'
              : 'definition-invalid',
          ref,
        });
      }
      if (ref.kind === 'transformation-execution') {
        const loaded = await this._executionStore.read(
          input.executionsDir,
          ref.id,
        );
        if (loaded) continue;
        const diagnosis = await this._executionStore.diagnose(
          input.executionsDir,
          ref.id,
        );
        failures.push({
          code:
            diagnosis === 'missing' ? 'execution-missing' : 'execution-invalid',
          ref,
        });
      }
      if (ref.kind === 'derived-record') {
        const loaded = await this._recordStore.read(input.outputDir, ref.id);
        if (loaded) continue;
        const diagnosis = await this._recordStore.diagnose(
          input.outputDir,
          ref.id,
        );
        failures.push({
          code: diagnosis === 'missing' ? 'derived-missing' : 'derived-invalid',
          ref,
        });
      }
      if (ref.kind === 'source-conversation' || ref.kind === 'source-node') {
        const hash = ref.id.slice(0, 64);
        const graph = await this._graphStore.read(input.graphsDir, hash);
        if (!graph) continue;
        if (ref.kind === 'source-conversation') {
          const conversationId = ref.id.slice(65);
          if (!graph.conversations.some((c) => c.sourceId === conversationId)) {
            failures.push({ code: 'conversation-missing', ref });
          }
        } else {
          const rest = ref.id.slice(65);
          const split = rest.indexOf(':');
          const conversationId = rest.slice(0, split);
          const nodeId = rest.slice(split + 1);
          const conv = graph.conversations.find(
            (c) => c.sourceId === conversationId,
          );
          if (!conv) {
            failures.push({
              code: 'conversation-missing',
              ref: conversationRef(hash, conversationId),
            });
          } else if (!conv.nodes.some((n) => n.id === nodeId)) {
            failures.push({ code: 'node-missing', ref });
          }
        }
      }
    }
  }

  private resolveNodes(
    reachable: ProvenanceRef[],
    graphs: Map<string, ChatGptSourceGraph>,
    failures: ProvenanceFailure[],
  ): ProvenanceNode[] {
    const failed = new Set(
      failures
        .filter((item) => item.code !== 'cycle')
        .map((item) => refKey(item.ref)),
    );
    return reachable.map((ref) => {
      if (failed.has(refKey(ref))) {
        return { ...ref, resolved: false };
      }
      if (ref.kind === 'source-archive') {
        return { ...ref, resolved: graphs.has(ref.id) };
      }
      return { ...ref, resolved: true };
    });
  }
}
