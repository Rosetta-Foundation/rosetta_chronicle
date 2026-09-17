import { ContextPacketBranch, ContextPacketEventTimeStatus } from '../types';
import { isRecord } from './chatgpt-export.utils';
import { conversationIdOf, mappingOf } from './source-content.utils';

export interface ExtractedPart {
  index: number;
  text: string;
  start: number;
  end: number;
}

export interface DiagnosticNode {
  conversationId: string;
  nodeId: string;
  role: string;
  eventTime: string | null;
  eventTimeStatus: ContextPacketEventTimeStatus;
  parentId: string | null;
  branch: ContextPacketBranch;
  text: string;
  parts: ExtractedPart[];
  unsupported: boolean;
}

export interface ConversationTopology {
  conversationId: string;
  currentNode?: string;
  mapping: Record<string, unknown>;
}

export interface ShardParseResult {
  nodes: DiagnosticNode[];
  conversations: ConversationTopology[];
  malformedJson: boolean;
  malformedConversations: number;
  unsupportedNodes: number;
  cyclicOrMissingParent: boolean;
}

const MIN_EVENT_MS = Date.UTC(1970, 0, 1);
const MAX_EVENT_MS = Date.UTC(2100, 0, 1);

/**
 * Join string parts with newlines while keeping source offsets.
 * Object parts are skipped — attachments are not invented text.
 */
export const extractStringParts = (
  parts: unknown,
): { parts: ExtractedPart[]; text: string; unsupported: boolean } => {
  if (!Array.isArray(parts)) {
    return { parts: [], text: '', unsupported: parts !== undefined };
  }
  const extracted: ExtractedPart[] = [];
  let text = '';
  let unsupported = false;
  parts.forEach((part, index) => {
    if (typeof part !== 'string') {
      unsupported = true;
      return;
    }
    if (text.length > 0) text += '\n';
    const start = text.length;
    text += part;
    extracted.push({ index, text: part, start, end: text.length });
  });
  return { parts: extracted, text, unsupported };
};

export const eventTimeOfNode = (
  node: unknown,
): { iso: string | null; status: ContextPacketEventTimeStatus } => {
  if (!isRecord(node)) return { iso: null, status: 'unknown' };
  const message = node['message'];
  if (!isRecord(message)) return { iso: null, status: 'unknown' };
  const raw = message['create_time'];
  if (raw === undefined || raw === null) {
    return { iso: null, status: 'unknown' };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { iso: null, status: 'invalid' };
  }
  const ms = raw * 1000;
  if (ms < MIN_EVENT_MS || ms >= MAX_EVENT_MS) {
    return { iso: null, status: 'invalid' };
  }
  const iso = new Date(ms).toISOString();
  if (iso === 'Invalid Date') return { iso: null, status: 'invalid' };
  return { iso, status: 'dated' };
};

const roleOf = (node: unknown): string => {
  if (!isRecord(node)) return 'unknown';
  const message = node['message'];
  if (!isRecord(message)) return 'unknown';
  const author = isRecord(message['author']) ? message['author'] : undefined;
  return typeof author?.['role'] === 'string' && author['role'].length > 0
    ? author['role']
    : 'unknown';
};

const parentOf = (node: unknown): string | null => {
  if (!isRecord(node)) return null;
  const parent = node['parent'];
  return typeof parent === 'string' && parent.length > 0 ? parent : null;
};

/**
 * Walk parent links from `current_node`. Cycles or a missing parent
 * make membership unknown rather than inventing a current path.
 */
export const classifyBranch = (
  mapping: Record<string, unknown>,
  currentNode: string | undefined,
  nodeId: string,
): { branch: ContextPacketBranch; broken: boolean } => {
  if (currentNode === undefined || currentNode.length === 0) {
    return { branch: 'unknown', broken: false };
  }
  const seen = new Set<string>();
  let cursor: string | undefined = currentNode;
  const path = new Set<string>();
  while (cursor !== undefined) {
    if (seen.has(cursor)) {
      return { branch: 'unknown', broken: true };
    }
    seen.add(cursor);
    path.add(cursor);
    const node = mapping[cursor];
    if (node === undefined) {
      return { branch: 'unknown', broken: true };
    }
    const parent = parentOf(node);
    if (parent === null) break;
    cursor = parent;
  }
  return {
    branch: path.has(nodeId) ? 'current-path' : 'off-path',
    broken: false,
  };
};

export const currentPathChildOf = (
  mapping: Record<string, unknown>,
  parentId: string,
  currentNode: string | undefined,
): { childId: string } | { ambiguous: true } | { none: true } => {
  const children: string[] = [];
  for (const [id, node] of Object.entries(mapping)) {
    if (parentOf(node) === parentId) children.push(id);
  }
  if (children.length === 0) return { none: true };
  if (currentNode === undefined) {
    return children.length === 1
      ? { childId: children[0] as string }
      : { ambiguous: true };
  }
  const onPath = children.filter((id) => {
    const classified = classifyBranch(mapping, currentNode, id);
    return classified.branch === 'current-path' && !classified.broken;
  });
  if (onPath.length === 1) return { childId: onPath[0] as string };
  if (onPath.length === 0 && children.length === 1) {
    return { childId: children[0] as string };
  }
  return { ambiguous: true };
};

/**
 * Diagnostic walk of a ChatGPT conversation shard. Does not throw on
 * bad JSON. Empty text is not treated as a historical claim.
 */
export const parseShardDiagnostics = (bytes: Buffer): ShardParseResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    return {
      nodes: [],
      conversations: [],
      malformedJson: true,
      malformedConversations: 0,
      unsupportedNodes: 0,
      cyclicOrMissingParent: false,
    };
  }
  if (!Array.isArray(parsed)) {
    return {
      nodes: [],
      conversations: [],
      malformedJson: true,
      malformedConversations: 0,
      unsupportedNodes: 0,
      cyclicOrMissingParent: false,
    };
  }
  const nodes: DiagnosticNode[] = [];
  const conversations: ConversationTopology[] = [];
  let malformedConversations = 0;
  let unsupportedNodes = 0;
  let cyclicOrMissingParent = false;
  for (const conv of parsed) {
    const conversationId = conversationIdOf(conv);
    const mapping = mappingOf(conv);
    if (!conversationId || !mapping) {
      malformedConversations += 1;
      continue;
    }
    const currentNode =
      isRecord(conv) && typeof conv['current_node'] === 'string'
        ? conv['current_node']
        : undefined;
    conversations.push({
      conversationId,
      ...(currentNode !== undefined ? { currentNode } : {}),
      mapping,
    });
    for (const [nodeId, node] of Object.entries(mapping)) {
      if (!isRecord(node)) {
        unsupportedNodes += 1;
        continue;
      }
      const message = node['message'];
      if (message == null) continue;
      if (!isRecord(message)) {
        unsupportedNodes += 1;
        continue;
      }
      const content = isRecord(message['content'])
        ? message['content']
        : undefined;
      const extracted = extractStringParts(content?.['parts']);
      if (extracted.unsupported) unsupportedNodes += 1;
      if (extracted.text.length === 0) continue;
      const clock = eventTimeOfNode(node);
      const classified = classifyBranch(mapping, currentNode, nodeId);
      if (classified.broken) cyclicOrMissingParent = true;
      nodes.push({
        conversationId,
        nodeId,
        role: roleOf(node),
        eventTime: clock.iso,
        eventTimeStatus: clock.status,
        parentId: parentOf(node),
        branch: classified.branch,
        text: extracted.text,
        parts: extracted.parts,
        unsupported: extracted.unsupported,
      });
    }
  }
  return {
    nodes,
    conversations,
    malformedJson: false,
    malformedConversations,
    unsupportedNodes,
    cyclicOrMissingParent,
  };
};

export interface ExcerptWindow {
  excerpt: string;
  excerptKind: 'raw' | 'transformed';
  excerptTruncated: boolean;
  partIndex?: number;
  rawStart?: number;
  rawEnd?: number;
}

/**
 * Bound an excerpt around the first match. Prefer raw offsets when
 * the match sits inside one stored string part.
 */
export const boundRawExcerpt = (
  node: DiagnosticNode,
  matchStart: number,
  matchLength: number,
  maxChars: number,
): ExcerptWindow => {
  if (maxChars <= 0) {
    return { excerpt: '', excerptKind: 'raw', excerptTruncated: true };
  }
  const extra = Math.max(0, maxChars - matchLength);
  const before = Math.floor(extra / 2);
  let start = Math.max(0, matchStart - before);
  let end = Math.min(node.text.length, start + maxChars);
  if (end - start < maxChars) {
    start = Math.max(0, end - maxChars);
  }
  const excerpt = node.text.slice(start, end);
  const truncated = start > 0 || end < node.text.length;
  const covering = node.parts.find(
    (part) => matchStart >= part.start && matchStart < part.end,
  );
  return {
    excerpt,
    excerptKind: 'raw',
    excerptTruncated: truncated,
    ...(covering ? { partIndex: covering.index } : {}),
    rawStart: start,
    rawEnd: end,
  };
};
