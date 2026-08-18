import {
  ChatGptSourceGraph,
  DerivedEvaluation,
  DerivedRecord,
  DerivedSourceRef,
  ProvenanceDirection,
  ProvenanceEdge,
  ProvenanceFailure,
  ProvenanceNode,
  ProvenanceNodeKind,
  ProvenancePath,
  ProvenanceRef,
  TransformationExecution,
} from '../types';
import { CONTENT_HASH } from './derived-record.utils';

const NODE_KINDS: readonly ProvenanceNodeKind[] = [
  'source-archive',
  'source-conversation',
  'source-node',
  'transformation-definition',
  'transformation-execution',
  'derived-record',
  'evaluation',
];

const KIND_ALIASES: Record<string, ProvenanceNodeKind> = {
  execution: 'transformation-execution',
  definition: 'transformation-definition',
};

export const ARCHIVE_REF = (hash: string): ProvenanceRef => ({
  kind: 'source-archive',
  id: hash,
});

export const conversationRef = (
  hash: string,
  conversationId: string,
): ProvenanceRef => ({
  kind: 'source-conversation',
  id: `${hash}:${conversationId}`,
});

export const nodeRef = (
  hash: string,
  conversationId: string,
  nodeId: string,
): ProvenanceRef => ({
  kind: 'source-node',
  id: `${hash}:${conversationId}:${nodeId}`,
});

export const refKey = (ref: ProvenanceRef): string =>
  `${ref.kind}:${ref.id}`;

export const sameRef = (a: ProvenanceRef, b: ProvenanceRef): boolean =>
  a.kind === b.kind && a.id === b.id;

export const compareRefs = (a: ProvenanceRef, b: ProvenanceRef): number =>
  a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind);

export const compareEdges = (a: ProvenanceEdge, b: ProvenanceEdge): number =>
  a.type !== b.type
    ? a.type.localeCompare(b.type)
    : compareRefs(a.from, b.from) || compareRefs(a.to, b.to);

/**
 * Parse `--from kind:id`. `source-conversation` and `source-node` ids
 * contain colons after a 64-hex archive hash.
 */
export const parseProvenanceFrom = (
  value: string,
): { ref?: ProvenanceRef; error?: string } => {
  const colon = value.indexOf(':');
  if (colon <= 0) return { error: 'from-unparseable' };
  const raw = value.slice(0, colon);
  const kind = (KIND_ALIASES[raw] ?? raw) as ProvenanceNodeKind;
  const id = value.slice(colon + 1);
  if (!NODE_KINDS.includes(kind) || !id) {
    return { error: `from-unknown-kind:${raw}` };
  }
  if (
    (kind === 'source-archive' ||
      kind === 'transformation-definition' ||
      kind === 'transformation-execution' ||
      kind === 'derived-record' ||
      kind === 'evaluation') &&
    !CONTENT_HASH.test(id)
  ) {
    return { error: 'from-id-invalid' };
  }
  if (kind === 'source-conversation') {
    const hash = id.slice(0, 64);
    if (!CONTENT_HASH.test(hash) || id[64] !== ':') {
      return { error: 'from-id-invalid' };
    }
  }
  if (kind === 'source-node') {
    const hash = id.slice(0, 64);
    const rest = id.slice(65);
    if (!CONTENT_HASH.test(hash) || id[64] !== ':' || !rest.includes(':')) {
      return { error: 'from-id-invalid' };
    }
  }
  return { ref: { kind, id } };
};

export const sourceRefsFrom = (
  ref: DerivedSourceRef,
): ProvenanceRef[] => {
  const hash = ref.sourceGraphHash;
  const found: ProvenanceRef[] = [ARCHIVE_REF(hash)];
  if (ref.conversationId) {
    found.push(conversationRef(hash, ref.conversationId));
    for (const nodeId of ref.nodeIds) {
      found.push(nodeRef(hash, ref.conversationId, nodeId));
    }
  }
  return found;
};

const edge = (
  type: ProvenanceEdge['type'],
  from: ProvenanceRef,
  to: ProvenanceRef,
): ProvenanceEdge => ({ type, from, to });

/**
 * Build the canonical directed edges from loaded artifacts.
 * Does not invent missing targets — callers mark those unresolved.
 */
export const buildProvenanceEdges = (input: {
  executions: TransformationExecution[];
  derived: DerivedRecord[];
  graphs: Map<string, ChatGptSourceGraph>;
  evaluations?: DerivedEvaluation[];
}): ProvenanceEdge[] => {
  const edges: ProvenanceEdge[] = [];
  for (const [hash, graph] of [...input.graphs.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const archive = ARCHIVE_REF(hash);
    for (const conv of graph.conversations) {
      const conversation = conversationRef(hash, conv.sourceId);
      edges.push(edge('contains', archive, conversation));
      for (const node of conv.nodes) {
        edges.push(
          edge('contains', conversation, nodeRef(hash, conv.sourceId, node.id)),
        );
      }
    }
  }
  for (const execution of input.executions) {
    const from: ProvenanceRef = {
      kind: 'transformation-execution',
      id: execution.id,
    };
    edges.push(
      edge('cites', from, {
        kind: 'transformation-definition',
        id: execution.definitionId,
      }),
    );
    for (const source of execution.sourceRefs) {
      for (const to of sourceRefsFrom(source)) {
        edges.push(edge('cites', from, to));
      }
    }
    for (const derivedId of execution.outputRefs) {
      edges.push(
        edge('produces', from, { kind: 'derived-record', id: derivedId }),
      );
    }
  }
  for (const record of input.derived) {
    const from: ProvenanceRef = { kind: 'derived-record', id: record.id };
    if (record.executionId) {
      edges.push(
        edge('produces', {
          kind: 'transformation-execution',
          id: record.executionId,
        }, from),
      );
    }
    for (const source of record.sourceRefs) {
      for (const to of sourceRefsFrom(source)) {
        edges.push(edge('cites', from, to));
      }
    }
  }
  for (const evaluation of input.evaluations ?? []) {
    const from: ProvenanceRef = { kind: 'evaluation', id: evaluation.id };
    edges.push(
      edge('evaluates', from, {
        kind: 'derived-record',
        id: evaluation.evaluatedRecordId,
      }),
    );
    if (evaluation.suppliedRecordId) {
      edges.push(
        edge('cites', from, {
          kind: 'derived-record',
          id: evaluation.suppliedRecordId,
        }),
      );
    }
  }
  return dedupeEdges(edges);
};

const edgeKey = (item: ProvenanceEdge): string =>
  `${item.type}|${refKey(item.from)}|${refKey(item.to)}`;

export const dedupeEdges = (edges: ProvenanceEdge[]): ProvenanceEdge[] => {
  const seen = new Set<string>();
  const unique: ProvenanceEdge[] = [];
  for (const item of edges) {
    const key = edgeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique.sort(compareEdges);
};

/**
 * Neighbors in the walk direction.
 * Forward follows outgoing produces/contains and incoming cites/evaluates.
 * Backward is the inverse — incoming produces/contains and outgoing
 * cites/evaluates. Stored `evaluates` points evaluation → derived;
 * forward still discovers the evaluation from the derived record.
 */
export const walkNeighbors = (
  current: ProvenanceRef,
  direction: ProvenanceDirection,
  edges: ProvenanceEdge[],
): ProvenanceRef[] => {
  const found: ProvenanceRef[] = [];
  const structural =
    (item: ProvenanceEdge) =>
      item.type === 'produces' || item.type === 'contains';
  const inverse =
    (item: ProvenanceEdge) =>
      item.type === 'cites' || item.type === 'evaluates';
  for (const item of edges) {
    if (direction === 'forward') {
      if (structural(item) && sameRef(item.from, current)) {
        found.push(item.to);
      }
      if (inverse(item) && sameRef(item.to, current)) {
        found.push(item.from);
      }
    } else {
      if (structural(item) && sameRef(item.to, current)) {
        found.push(item.from);
      }
      if (inverse(item) && sameRef(item.from, current)) {
        found.push(item.to);
      }
    }
  }
  return found.sort(compareRefs);
};

/**
 * Simple paths from start. Cycles record a failure and stop that walk.
 * Duplicate nodes on one path are not re-expanded.
 */
export const collectPaths = (
  start: ProvenanceRef,
  direction: ProvenanceDirection,
  edges: ProvenanceEdge[],
  failures: ProvenanceFailure[],
): ProvenancePath[] => {
  const paths: ProvenancePath[] = [];
  const visit = (path: ProvenanceRef[]): void => {
    const current = path[path.length - 1];
    const next = walkNeighbors(current, direction, edges);
    const unused = next.filter(
      (ref) => !path.some((seen) => sameRef(seen, ref)),
    );
    const cyclic = next.filter((ref) =>
      path.some((seen) => sameRef(seen, ref)),
    );
    for (const ref of cyclic) {
      failures.push({ code: 'cycle', ref, citedBy: current });
    }
    if (unused.length === 0) {
      paths.push({ nodes: path });
      return;
    }
    for (const ref of unused) {
      visit([...path, ref]);
    }
  };
  visit([start]);
  return paths.sort((a, b) => {
    const left = a.nodes.map(refKey).join('>');
    const right = b.nodes.map(refKey).join('>');
    return left.localeCompare(right);
  });
};

export const sortNodes = (nodes: ProvenanceNode[]): ProvenanceNode[] =>
  [...nodes].sort(compareRefs);

export const uniqueFailures = (
  failures: ProvenanceFailure[],
): ProvenanceFailure[] => {
  const seen = new Set<string>();
  const unique: ProvenanceFailure[] = [];
  for (const item of failures) {
    const key = `${item.code}|${refKey(item.ref)}|${item.citedBy ? refKey(item.citedBy) : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique.sort((a, b) =>
    a.code === b.code
      ? compareRefs(a.ref, b.ref)
      : a.code.localeCompare(b.code),
  );
};
