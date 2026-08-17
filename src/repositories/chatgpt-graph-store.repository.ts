import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { injectable } from 'inversify';
import { ChatGptSourceGraph } from '../types';

/**
 * Persistence adapter for a normalized ChatGPT conversation graph.
 *
 * Resource access only. Writes `<outputDir>/<contentHash>.json` — the
 * caller supplies the directory. This store does not know about personal
 * Chronicle layouts, Daily Chronicle sidecars, or export-archive bytes.
 */
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
}

const CONTENT_HASH = /^[a-f0-9]{64}$/;

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
      return JSON.parse(readFileSync(absPath, 'utf-8')) as ChatGptSourceGraph;
    } catch {
      return null;
    }
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
}
