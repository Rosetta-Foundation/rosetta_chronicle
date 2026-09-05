import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { injectable } from 'inversify';
import { ChatGptSourceGraph, StoreInventory } from '../types';

/**
 * Persistence adapter for a normalized ChatGPT conversation graph.
 *
 * Resource access only. Writes `<outputDir>/<contentHash>.json` — the
 * caller supplies the directory. This store does not know about personal
 * Chronicle layouts, Daily Chronicle sidecars, or export-archive bytes.
 */
export type GraphResolveStatus = 'ok' | 'missing' | 'invalid';

export interface IChatGptGraphStore {
  /** Read the graph for `contentHash`, or null if absent or unreadable. */
  read(
    outputDir: string,
    contentHash: string,
  ): Promise<ChatGptSourceGraph | null>;
  /**
   * Write `graph` at the hash-keyed path. Overwrites the file; callers
   * that need idempotency must read first.
   */
  write(outputDir: string, graph: ChatGptSourceGraph): Promise<string>;
  /** Absolute path where the graph for `contentHash` would live. */
  pathFor(outputDir: string, contentHash: string): string;
  /** Read a graph JSON file at an explicit path, or null if unreadable. */
  readAt(filePath: string): Promise<ChatGptSourceGraph | null>;
  diagnose(
    outputDir: string,
    contentHash: string,
  ): Promise<GraphResolveStatus>;
  /**
   * Enumerate valid source graphs and structurally invalid siblings.
   * `read` remains the valid-only helper. Conversation view must use
   * this so `ok` is not claimed over silent corruption.
   */
  listResolved(outputDir: string): Promise<StoreInventory<ChatGptSourceGraph>>;
}

const CONTENT_HASH = /^[a-f0-9]{64}$/;

const isSourceGraph = (value: unknown): value is ChatGptSourceGraph => {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  const archive = rec.archive;
  if (!archive || typeof archive !== 'object') return false;
  const a = archive as Record<string, unknown>;
  return (
    typeof a.contentHash === 'string' &&
    CONTENT_HASH.test(a.contentHash) &&
    typeof a.importedAt === 'string' &&
    Array.isArray(rec.conversations)
  );
};

/**
 * Filesystem implementation of {@link IChatGptGraphStore}.
 *
 * One JSON file per archive content hash, named by the hash, in the
 * directory the caller chose. A malformed file reads back as null so a
 * re-import can rewrite it.
 */
@injectable()
export class ChatGptGraphStore implements IChatGptGraphStore {
  /** @inheritDoc */
  pathFor(outputDir: string, contentHash: string): string {
    return path.join(outputDir, `${contentHash}.json`);
  }

  /** @inheritDoc */
  async read(
    outputDir: string,
    contentHash: string,
  ): Promise<ChatGptSourceGraph | null> {
    if (!CONTENT_HASH.test(contentHash)) return null;
    const absPath = this.pathFor(outputDir, contentHash);
    if (!existsSync(absPath)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(absPath, 'utf-8'));
      return isSourceGraph(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** @inheritDoc */
  async diagnose(
    outputDir: string,
    contentHash: string,
  ): Promise<GraphResolveStatus> {
    if (!CONTENT_HASH.test(contentHash)) return 'invalid';
    const absPath = this.pathFor(outputDir, contentHash);
    if (!existsSync(absPath)) return 'missing';
    const loaded = await this.read(outputDir, contentHash);
    return loaded ? 'ok' : 'invalid';
  }

  /** @inheritDoc */
  async write(outputDir: string, graph: ChatGptSourceGraph): Promise<string> {
    const hash = graph.archive.contentHash;
    if (!CONTENT_HASH.test(hash)) {
      throw new Error(`invalid content hash: ${hash}`);
    }
    const absPath = this.pathFor(outputDir, hash);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(absPath, JSON.stringify(graph, null, 2) + '\n');
    return absPath;
  }

  /** @inheritDoc */
  async readAt(filePath: string): Promise<ChatGptSourceGraph | null> {
    if (!filePath || !existsSync(filePath)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'));
      return isSourceGraph(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** @inheritDoc */
  async listResolved(
    outputDir: string,
  ): Promise<StoreInventory<ChatGptSourceGraph>> {
    if (!existsSync(outputDir)) {
      return { present: false, records: [], failures: [] };
    }
    const records: ChatGptSourceGraph[] = [];
    const failures: StoreInventory<ChatGptSourceGraph>['failures'] = [];
    for (const name of readdirSync(outputDir).sort()) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      const record = CONTENT_HASH.test(id)
        ? await this.read(outputDir, id)
        : null;
      if (record && record.archive.contentHash === id) {
        records.push(record);
        continue;
      }
      failures.push({
        filename: name,
        ...(CONTENT_HASH.test(id) ? { id } : {}),
        status: 'invalid',
      });
    }
    return { present: true, records, failures };
  }
}
