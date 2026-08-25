import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'fs';
import { join } from 'path';
import { injectable } from 'inversify';
import {
  ChatGptSourceGraph,
  ResolvedSourceNode,
  SourceResolveResult,
} from '../types';
import { sha256Hex } from '../utils/chatgpt-export.utils';
import {
  conversationIdOf,
  extractRawNode,
  mappingOf,
} from '../utils/source-content.utils';

/**
 * Privileged resolver: sourceRef → ephemeral private node text.
 *
 * Separate from {@link IChatGptExportRepository}, which must never
 * return parts or titles. This repository does not write, and callers
 * must not persist the returned text.
 */
export interface ISourceContentRepository {
  resolve(input: {
    exportPath: string;
    sourceGraphHash: string;
    conversationId: string;
    nodeIds: string[];
    graph: ChatGptSourceGraph;
  }): Promise<SourceResolveResult>;
}

const CONVERSATION_SHARD = /^conversations(?:-\d+)?\.json$/;
const UNZIP_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Filesystem implementation of {@link ISourceContentRepository}.
 *
 * Verifies the live export hash matches the cited source graph, then
 * extracts only the cited nodes. Attachment presence comes from the
 * already-imported graph, not from inventing blob contents.
 *
 * `exportPath` is a locator, not identity: a same-bytes directory tree
 * at a different path hashes the same and resolve succeeds. Identity is
 * the shard-name + shard-bytes SHA-256.
 */
@injectable()
export class SourceContentRepository implements ISourceContentRepository {
  /** @inheritDoc */
  async resolve(input: {
    exportPath: string;
    sourceGraphHash: string;
    conversationId: string;
    nodeIds: string[];
    graph: ChatGptSourceGraph;
  }): Promise<SourceResolveResult> {
    if (!input.exportPath || !existsSync(input.exportPath)) {
      return { ok: false, error: 'export-missing' };
    }
    let loaded: { contentHash: string; conversations: unknown[] };
    try {
      const stat = statSync(input.exportPath);
      if (stat.isDirectory()) {
        loaded = this.readDirectory(input.exportPath);
      } else if (
        stat.isFile() &&
        input.exportPath.toLowerCase().endsWith('.zip')
      ) {
        loaded = this.readArchive(input.exportPath);
      } else {
        return { ok: false, error: 'export-invalid' };
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    if (loaded.contentHash !== input.sourceGraphHash) {
      return { ok: false, error: 'source-content-hash-mismatch' };
    }
    if (input.graph.archive.contentHash !== input.sourceGraphHash) {
      return { ok: false, error: 'source-graph-hash-mismatch' };
    }
    const conversation = loaded.conversations.find(
      (item) => conversationIdOf(item) === input.conversationId,
    );
    if (!conversation) {
      return {
        ok: false,
        error: `conversation-missing:${input.conversationId}`,
      };
    }
    const mapping = mappingOf(conversation);
    if (!mapping) {
      return { ok: false, error: 'mapping-missing' };
    }
    const graphConv = input.graph.conversations.find(
      (item) => item.sourceId === input.conversationId,
    );
    const nodes: ResolvedSourceNode[] = [];
    const missing: string[] = [];
    for (const nodeId of input.nodeIds) {
      const extracted = extractRawNode(mapping[nodeId], nodeId);
      if ('error' in extracted) {
        missing.push(extracted.error);
        continue;
      }
      const graphNode = graphConv?.nodes.find((item) => item.id === nodeId);
      extracted.attachments = extracted.attachments.map((attachment) => {
        const fromGraph = graphNode?.attachments.find(
          (item) => item.id && item.id === attachment.id,
        );
        return {
          ...attachment,
          presentInArchive: fromGraph?.presentInArchive === true,
        };
      });
      if (graphNode) {
        for (const ref of graphNode.attachments) {
          if (
            ref.id &&
            !extracted.attachments.some((item) => item.id === ref.id)
          ) {
            extracted.attachments.push({
              id: ref.id,
              presentInArchive: ref.presentInArchive,
              ...(ref.mimeType ? { mimeType: ref.mimeType } : {}),
            });
          }
        }
      }
      nodes.push(extracted);
    }
    if (missing.length > 0) {
      return {
        ok: false,
        error:
          missing.length === input.nodeIds.length
            ? missing[0]
            : `partial-source-resolution:${missing.join(',')}`,
      };
    }
    return { ok: true, contentHash: loaded.contentHash, nodes };
  }

  private readDirectory(dir: string): {
    contentHash: string;
    conversations: unknown[];
  } {
    const names = readdirSync(dir);
    const shardNames = names.filter((n) => CONVERSATION_SHARD.test(n)).sort();
    const hash = createHash('sha256');
    const conversations: unknown[] = [];
    for (const shard of shardNames) {
      const bytes = readFileSync(join(dir, shard));
      hash.update(shard);
      hash.update(bytes);
      this.ingestShard(bytes, conversations);
    }
    return { contentHash: hash.digest('hex'), conversations };
  }

  private readArchive(zipPath: string): {
    contentHash: string;
    conversations: unknown[];
  } {
    const listing = this.unzipNames(zipPath);
    const shardPaths = listing
      .filter((n) => CONVERSATION_SHARD.test(n.split('/').pop() ?? n))
      .sort();
    const conversations: unknown[] = [];
    for (const shardPath of shardPaths) {
      const bytes = this.unzipFile(zipPath, shardPath);
      this.ingestShard(bytes, conversations);
    }
    return {
      contentHash: sha256Hex(readFileSync(zipPath)),
      conversations,
    };
  }

  private ingestShard(bytes: Buffer, conversations: unknown[]): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) conversations.push(item);
  }

  private unzipNames(zipPath: string): string[] {
    const out = execFileSync('unzip', ['-Z', '-1', zipPath], {
      encoding: 'utf8',
      maxBuffer: UNZIP_MAX_BUFFER,
    });
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  private unzipFile(zipPath: string, entry: string): Buffer {
    return execFileSync('unzip', ['-p', zipPath, entry], {
      maxBuffer: UNZIP_MAX_BUFFER,
    });
  }
}
