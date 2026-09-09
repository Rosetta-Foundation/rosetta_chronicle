import { basename } from 'path';
import { ObservationReceipt } from '../types';
import {
  conversationIdOf,
  extractRawNode,
  mappingOf,
} from './source-content.utils';
import { isRecord } from './chatgpt-export.utils';

export const CONVERSATION_SHARD_NAME = /^conversations-\d{3}\.json$/;

export const DEFAULT_SEARCH_LIMIT = 20;
export const DEFAULT_SNIPPET_CHARS = 240;

/**
 * Conversation shards Chronicle will scan. Cursor JSONL and other
 * allowlisted files are ignored — this specimen is ChatGPT mapping
 * text only.
 */
export const isConversationShardPath = (sourcePath: string): boolean =>
  CONVERSATION_SHARD_NAME.test(basename(sourcePath));

/**
 * One vault object per content hash. Later receipts for the same
 * bytes do not change identity.
 */
export const uniqueShardReceipts = (
  receipts: ObservationReceipt[],
  allowedScopeIds: Set<string>,
): ObservationReceipt[] => {
  const byHash = new Map<string, ObservationReceipt>();
  for (const receipt of receipts) {
    if (!allowedScopeIds.has(receipt.scopeId)) continue;
    if (!isConversationShardPath(receipt.sourcePath)) continue;
    const prev = byHash.get(receipt.contentHash);
    if (!prev || receipt.capturedAt > prev.capturedAt) {
      byHash.set(receipt.contentHash, receipt);
    }
  }
  return [...byHash.values()];
};

const collapseWs = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Thin lexical rewrite for `--match normalized`. Collapses whitespace
 * and strips `*` / `_` emphasis markers. Does not touch punctuation,
 * stem words, or generate variants. `snake_case` becomes `snakecase`.
 */
export const normalizeLexicalText = (text: string): string =>
  collapseWs(text.replace(/[*_]/g, ''));

/**
 * Case-insensitive substring. Empty query is not a match.
 */
export const lexicalIndexOf = (haystack: string, query: string): number => {
  if (query.length === 0) return -1;
  return haystack.toLowerCase().indexOf(query.toLowerCase());
};

/**
 * Bound a snippet around the first match. Does not invent text.
 */
export const boundSnippet = (
  text: string,
  query: string,
  maxChars: number,
): string => {
  const flat = collapseWs(text);
  if (maxChars <= 0) return '';
  const at = lexicalIndexOf(flat, query);
  if (at < 0) {
    return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars)}…`;
  }
  const qLen = query.length;
  const extra = Math.max(0, maxChars - qLen);
  const before = Math.floor(extra / 2);
  const start = Math.max(0, at - before);
  let slice = flat.slice(start, start + maxChars);
  if (start > 0) slice = `…${slice}`;
  if (start + maxChars < flat.length) slice = `${slice}…`;
  return slice;
};

export interface ShardNode {
  conversationId: string;
  nodeId: string;
  role?: string;
  eventTime?: string;
  text: string;
}

const eventTimeOf = (node: unknown): string | undefined => {
  if (!isRecord(node)) return undefined;
  const message = node['message'];
  if (!isRecord(message)) return undefined;
  const raw = message['create_time'];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  return new Date(raw * 1000).toISOString();
};

/**
 * Walk every mapping node that has extractable text. Off-current-path
 * siblings are included — that is the V1 branch policy.
 */
export const walkShardNodes = (bytes: Buffer): ShardNode[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ShardNode[] = [];
  for (const conv of parsed) {
    const conversationId = conversationIdOf(conv);
    const mapping = mappingOf(conv);
    if (!conversationId || !mapping) continue;
    for (const [nodeId, node] of Object.entries(mapping)) {
      const extracted = extractRawNode(node, nodeId);
      if ('error' in extracted) continue;
      if (extracted.text.length === 0) continue;
      const role = extracted.role;
      const eventTime = eventTimeOf(node);
      out.push({
        conversationId,
        nodeId,
        ...(role ? { role } : {}),
        ...(eventTime ? { eventTime } : {}),
        text: extracted.text,
      });
    }
  }
  return out;
};
