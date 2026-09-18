import {
  ContextPacketEvidenceItem,
  ContextPacketOccurrenceRef,
  ContextPacketSelectionReason,
} from '../types';
import { lexicalIndexOf, normalizeLexicalText } from './lexical-search.utils';
import {
  boundRawExcerpt,
  currentPathChildOf,
  DiagnosticNode,
} from './context-packet-extract.utils';

export interface EligibleOccurrence extends ContextPacketOccurrenceRef {
  capturedAt: string;
  sourcePath: string;
}

export interface PacketCandidate {
  occurrence: EligibleOccurrence;
  node: DiagnosticNode;
  selectorIndexes: number[];
  reasons: ContextPacketSelectionReason[];
  matchStart: number;
  matchLength: number;
  excerptKind: 'raw' | 'transformed';
}

export const occurrenceKey = (
  occ: ContextPacketOccurrenceRef,
  conversationId: string,
  nodeId: string,
): string =>
  `${occ.scopeId}\0${occ.observationId}\0${occ.contentHash}\0${conversationId}\0${nodeId}`;

export const compareOccurrence = (
  a: PacketCandidate,
  b: PacketCandidate,
): number => {
  const aTime = a.node.eventTime ?? '';
  const bTime = b.node.eventTime ?? '';
  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  const aKey = occurrenceKey(
    a.occurrence,
    a.node.conversationId,
    a.node.nodeId,
  );
  const bKey = occurrenceKey(
    b.occurrence,
    b.node.conversationId,
    b.node.nodeId,
  );
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
};

const matchNeedle = (
  text: string,
  selector: string,
  matchMode: 'raw' | 'normalized',
): {
  start: number;
  length: number;
  reason: ContextPacketSelectionReason;
} | null => {
  if (matchMode === 'normalized') {
    const hay = normalizeLexicalText(text);
    const needle = normalizeLexicalText(selector);
    const at = lexicalIndexOf(hay, needle);
    if (at < 0) return null;
    return { start: at, length: needle.length, reason: 'normalized-match' };
  }
  const at = lexicalIndexOf(text, selector);
  if (at < 0) return null;
  return { start: at, length: selector.length, reason: 'literal-match' };
};

/**
 * Apply every selector to one node in a single pass. Selectors are
 * query alternatives, not stored aliases.
 */
export const matchNodeSelectors = (
  node: DiagnosticNode,
  selectors: string[],
  matchMode: 'raw' | 'normalized',
): {
  indexes: number[];
  reasons: ContextPacketSelectionReason[];
  start: number;
  length: number;
} | null => {
  const indexes: number[] = [];
  const reasons: ContextPacketSelectionReason[] = [];
  let start = -1;
  let length = 0;
  selectors.forEach((selector, index) => {
    const hit = matchNeedle(node.text, selector, matchMode);
    if (hit === null) return;
    indexes.push(index);
    if (!reasons.includes(hit.reason)) reasons.push(hit.reason);
    if (start < 0 || hit.start < start) {
      start = hit.start;
      length = hit.length;
    }
  });
  if (indexes.length === 0) return null;
  return { indexes, reasons, start, length };
};

const reservationSlots = (
  selectorCount: number,
): Array<{
  selector: number;
  kind: 'user-earliest' | 'user-latest' | 'assistant';
}> => {
  const slots: Array<{
    selector: number;
    kind: 'user-earliest' | 'user-latest' | 'assistant';
  }> = [];
  for (let i = 0; i < selectorCount; i += 1) {
    slots.push({ selector: i, kind: 'user-earliest' });
    slots.push({ selector: i, kind: 'user-latest' });
    slots.push({ selector: i, kind: 'assistant' });
  }
  return slots;
};

const pickReservation = (
  candidates: PacketCandidate[],
  selector: number,
  kind: 'user-earliest' | 'user-latest' | 'assistant',
): PacketCandidate | undefined => {
  const pool = candidates.filter((c) => {
    if (!c.selectorIndexes.includes(selector)) return false;
    if (kind === 'assistant') return c.node.role === 'assistant';
    return c.node.role === 'user' && c.node.eventTimeStatus === 'dated';
  });
  if (pool.length === 0) return undefined;
  const sorted = [...pool].sort(compareOccurrence);
  if (kind === 'user-latest') return sorted[sorted.length - 1];
  return sorted[0];
};

/**
 * Deterministic selection: reserve earliest/latest dated user and one
 * assistant per selector, then remaining dated, then undated. Hit caps
 * do not stop the scan; this only chooses after scanning.
 */
export const selectPacketEvidence = (
  candidates: PacketCandidate[],
  selectorCount: number,
  budget: number,
): {
  selected: PacketCandidate[];
  omitted: number;
  unsatisfied: string[];
  omissionCounts: Record<string, number>;
} => {
  const dated = candidates.filter((c) => c.node.eventTimeStatus === 'dated');
  const undated = candidates.filter((c) => c.node.eventTimeStatus !== 'dated');
  dated.sort(compareOccurrence);
  undated.sort(compareOccurrence);

  const chosen: PacketCandidate[] = [];
  const seen = new Set<string>();
  const take = (candidate: PacketCandidate | undefined): boolean => {
    if (candidate === undefined) return false;
    const key = occurrenceKey(
      candidate.occurrence,
      candidate.node.conversationId,
      candidate.node.nodeId,
    );
    if (seen.has(key)) return false;
    if (chosen.length >= budget) return false;
    seen.add(key);
    chosen.push(candidate);
    return true;
  };

  const unsatisfied: string[] = [];
  const slots = reservationSlots(selectorCount);
  if (slots.length <= budget) {
    for (const slot of slots) {
      const picked = pickReservation(dated, slot.selector, slot.kind);
      if (!take(picked)) {
        if (picked === undefined) {
          unsatisfied.push(`${slot.kind}:${slot.selector}`);
        }
      }
    }
  } else {
    let slotIndex = 0;
    while (chosen.length < budget && slotIndex < slots.length * 2) {
      const slot = slots[slotIndex % slots.length];
      if (slot) {
        const picked = pickReservation(dated, slot.selector, slot.kind);
        take(picked);
      }
      slotIndex += 1;
      if (slotIndex >= slots.length && chosen.length === 0) break;
      if (slotIndex >= slots.length && chosen.length > 0) {
        const remaining = slots.filter((s) => {
          const picked = pickReservation(dated, s.selector, s.kind);
          if (picked === undefined) return false;
          const key = occurrenceKey(
            picked.occurrence,
            picked.node.conversationId,
            picked.node.nodeId,
          );
          return !seen.has(key);
        });
        if (remaining.length === 0) break;
      }
    }
  }

  for (const candidate of dated) take(candidate);
  for (const candidate of undated) take(candidate);

  const omitted = candidates.length - chosen.length;
  const omissionCounts: Record<string, number> = {};
  if (omitted > 0) omissionCounts['over-item-budget'] = omitted;
  return { selected: chosen, omitted, unsatisfied, omissionCounts };
};

export const toEvidenceItem = (
  candidate: PacketCandidate,
  handle: string,
  maxExcerptChars: number,
  alternates: ContextPacketOccurrenceRef[],
): ContextPacketEvidenceItem => {
  const window =
    candidate.excerptKind === 'transformed'
      ? {
          excerpt: candidate.node.text.slice(0, Math.max(0, maxExcerptChars)),
          excerptKind: 'transformed' as const,
          excerptTruncated: candidate.node.text.length > maxExcerptChars,
        }
      : boundRawExcerpt(
          candidate.node,
          candidate.matchStart,
          candidate.matchLength,
          maxExcerptChars,
        );
  return {
    handle,
    ref: {
      kind: 'vault-node',
      scopeId: candidate.occurrence.scopeId,
      observationId: candidate.occurrence.observationId,
      contentHash: candidate.occurrence.contentHash,
      conversationId: candidate.node.conversationId,
      nodeId: candidate.node.nodeId,
    },
    alternateOccurrences: alternates,
    role: candidate.node.role,
    eventTime: candidate.node.eventTime,
    eventTimeStatus: candidate.node.eventTimeStatus,
    capturedAt: candidate.occurrence.capturedAt,
    branch: candidate.node.branch,
    excerpt: window.excerpt,
    excerptKind: window.excerptKind,
    excerptTruncated: window.excerptTruncated,
    ...(window.partIndex !== undefined ? { partIndex: window.partIndex } : {}),
    ...(window.rawStart !== undefined ? { rawStart: window.rawStart } : {}),
    ...(window.rawEnd !== undefined ? { rawEnd: window.rawEnd } : {}),
    reasons: candidate.reasons,
    selectorIndexes: candidate.selectorIndexes,
  };
};

export interface NeighborLookup {
  parent?: DiagnosticNode;
  child?: DiagnosticNode;
  ambiguous: boolean;
}

export const neighborNodes = (
  mappingNodes: DiagnosticNode[],
  selected: DiagnosticNode,
  mapping: Record<string, unknown> | undefined,
  currentNode: string | undefined,
): NeighborLookup => {
  const parent =
    selected.parentId === null
      ? undefined
      : mappingNodes.find(
          (n) =>
            n.conversationId === selected.conversationId &&
            n.nodeId === selected.parentId,
        );
  if (mapping === undefined) {
    return { parent, ambiguous: selected.parentId !== null && !parent };
  }
  const childResult = currentPathChildOf(mapping, selected.nodeId, currentNode);
  if ('ambiguous' in childResult) {
    return { parent, ambiguous: true };
  }
  if ('none' in childResult) {
    return { parent, ambiguous: false };
  }
  const child = mappingNodes.find(
    (n) =>
      n.conversationId === selected.conversationId &&
      n.nodeId === childResult.childId,
  );
  return { parent, child, ambiguous: false };
};

export const enforcePacketByteBudget = (
  items: ContextPacketEvidenceItem[],
  serialize: (items: ContextPacketEvidenceItem[]) => number,
  maxBytes: number,
): { items: ContextPacketEvidenceItem[]; dropped: number } => {
  let working = [...items];
  let dropped = 0;
  while (working.length > 0 && serialize(working) > maxBytes) {
    working = working.slice(0, working.length - 1);
    dropped += 1;
  }
  return { items: working, dropped };
};
