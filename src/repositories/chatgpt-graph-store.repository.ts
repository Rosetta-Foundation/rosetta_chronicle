import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { injectable } from 'inversify';
import { ChatGptSourceGraph } from '../types';

/**
 * Persistence adapter for a normalized ChatGPT conversation graph.
 *
 * Resource access only. Writes the source record under the personal
 * Chronicle repo; does not copy export bytes, emit Activity, or touch
 * Daily Chronicle files. Bytes stay outside the repository in this phase
 * while private storage policy is open — that is not a permanent ban.
 */
export interface IChatGptGraphStore {
  /** Read the graph for `contentHash`, or null if absent or unreadable. */
  read(
    repoPath: string,
    contentHash: string,
  ): Promise<ChatGptSourceGraph | null>;
  /**
   * Write `graph` at the hash-keyed path. Overwrites the file; callers
   * that need idempotency must read first.
   */
  write(repoPath: string, graph: ChatGptSourceGraph): Promise<string>;
  /** Absolute path where the graph for `contentHash` would live. */
  pathFor(repoPath: string, contentHash: string): string;
}

const GRAPH_DIR = path.join('chronicles', '.data', 'chatgpt-export');
const CONTENT_HASH = /^[a-f0-9]{64}$/;

/**
 * Filesystem implementation of {@link IChatGptGraphStore}.
 *
 * One JSON file per archive content hash. The file is a source record
 * (topology and type), not a Daily Chronicle sidecar. A malformed file
 * reads back as null so a re-import can rewrite it.
 */
@injectable()
export class ChatGptGraphStore implements IChatGptGraphStore {
  /** @inheritDoc */
  pathFor(repoPath: string, contentHash: string): string {
    return path.join(repoPath, GRAPH_DIR, `${contentHash}.json`);
  }

  /** @inheritDoc */
  async read(
    repoPath: string,
    contentHash: string,
  ): Promise<ChatGptSourceGraph | null> {
    if (!CONTENT_HASH.test(contentHash)) return null;
    const absPath = this.pathFor(repoPath, contentHash);
    if (!existsSync(absPath)) return null;
    try {
      return JSON.parse(readFileSync(absPath, 'utf-8')) as ChatGptSourceGraph;
    } catch {
      return null;
    }
  }

  /** @inheritDoc */
  async write(repoPath: string, graph: ChatGptSourceGraph): Promise<string> {
    const hash = graph.archive.contentHash;
    if (!CONTENT_HASH.test(hash)) {
      throw new Error(`invalid content hash: ${hash}`);
    }
    const absDir = path.join(repoPath, GRAPH_DIR);
    const absPath = this.pathFor(repoPath, hash);
    mkdirSync(absDir, { recursive: true });
    writeFileSync(absPath, JSON.stringify(graph, null, 2) + '\n');
    return absPath;
  }
}
