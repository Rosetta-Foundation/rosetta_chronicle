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
  ChatGptExportReadResult,
  ChatGptRawConversation,
  ChatGptUnsupportedRecord,
} from '../types';
import {
  sha256Hex,
  stripConversation,
} from '../utils/chatgpt-export.utils';

/**
 * Source adapter for an OpenAI ChatGPT export directory or zip.
 *
 * Resource access only: locate shards, read bytes, strip source text, hash
 * the archive. Classification and inventory aggregation belong in
 * {@link ChatGptInventoryService}. This repository never writes a Chronicle
 * and never returns message parts or conversation titles.
 */
export interface IChatGptExportRepository {
  read(exportPath: string): Promise<ChatGptExportReadResult>;
}

const CONVERSATION_SHARD = /^conversations(?:-\d+)?\.json$/;

/**
 * Filesystem implementation of {@link IChatGptExportRepository}.
 *
 * Directories are read in place. Archives are listed and projected with
 * `unzip` (same shell-out style as {@link GitRepository}) so attachment
 * blobs are not extracted. Invalid JSON and missing paths become an
 * explicit read result rather than an untyped throw.
 */
@injectable()
export class ChatGptExportRepository implements IChatGptExportRepository {
  /** @inheritDoc */
  async read(exportPath: string): Promise<ChatGptExportReadResult> {
    if (!exportPath || !existsSync(exportPath)) {
      return {
        ok: false,
        reason: 'missing',
        message: `export path not found: ${exportPath || '(empty)'}`,
      };
    }

    try {
      const stat = statSync(exportPath);
      if (stat.isDirectory()) {
        return { ok: true, export: this.readDirectory(exportPath) };
      }
      if (stat.isFile() && exportPath.toLowerCase().endsWith('.zip')) {
        return { ok: true, export: this.readArchive(exportPath) };
      }
      return {
        ok: false,
        reason: 'invalid',
        message: `export is neither a directory nor a .zip: ${exportPath}`,
      };
    } catch (err) {
      return {
        ok: false,
        reason: 'invalid',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private readDirectory(dir: string): ReturnType<
    ChatGptExportRepository['assemble']
  > {
    const names = readdirSync(dir);
    const shardNames = names.filter((n) => CONVERSATION_SHARD.test(n)).sort();
    const sidecarFiles = names
      .filter((n) => n.endsWith('.json') && !CONVERSATION_SHARD.test(n))
      .sort();
    const hash = createHash('sha256');
    const conversations: ChatGptRawConversation[] = [];
    const unsupported: ChatGptUnsupportedRecord[] = [];
    for (const shard of shardNames) {
      const bytes = readFileSync(join(dir, shard));
      hash.update(shard);
      hash.update(bytes);
      this.ingestShard(shard, bytes, conversations, unsupported);
    }
    return this.assemble({
      kind: 'directory',
      contentHash: hash.digest('hex'),
      shardNames,
      sidecarFiles,
      archiveFiles: names,
      conversations,
      unsupported,
    });
  }

  private readArchive(zipPath: string): ReturnType<
    ChatGptExportRepository['assemble']
  > {
    const listing = this.unzipNames(zipPath);
    const shardNames = listing
      .map((n) => n.split('/').pop() ?? n)
      .filter((n) => CONVERSATION_SHARD.test(n))
      .sort();
    const shardPaths = listing.filter((n) =>
      CONVERSATION_SHARD.test(n.split('/').pop() ?? n),
    );
    const sidecarFiles = listing
      .map((n) => n.split('/').pop() ?? n)
      .filter((n) => n.endsWith('.json') && !CONVERSATION_SHARD.test(n))
      .sort();
    const conversations: ChatGptRawConversation[] = [];
    const unsupported: ChatGptUnsupportedRecord[] = [];
    for (const shardPath of shardPaths.sort()) {
      const bytes = this.unzipFile(zipPath, shardPath);
      this.ingestShard(
        shardPath.split('/').pop() ?? shardPath,
        bytes,
        conversations,
        unsupported,
      );
    }
    return this.assemble({
      kind: 'archive',
      contentHash: sha256Hex(readFileSync(zipPath)),
      shardNames,
      sidecarFiles,
      archiveFiles: listing.map((n) => n.split('/').pop() ?? n),
      conversations,
      unsupported,
    });
  }

  private ingestShard(
    shard: string,
    bytes: Buffer,
    conversations: ChatGptRawConversation[],
    unsupported: ChatGptUnsupportedRecord[],
  ): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      unsupported.push({ reason: `invalid-json:${shard}` });
      return;
    }
    if (!Array.isArray(parsed)) {
      unsupported.push({ reason: `shard-not-array:${shard}` });
      return;
    }
    for (const item of parsed) {
      conversations.push(stripConversation(item));
    }
  }

  private assemble(raw: {
    kind: 'directory' | 'archive';
    contentHash: string;
    shardNames: string[];
    sidecarFiles: string[];
    archiveFiles: string[];
    conversations: ChatGptRawConversation[];
    unsupported: ChatGptUnsupportedRecord[];
  }) {
    return raw;
  }

  private unzipNames(zipPath: string): string[] {
    const out = execFileSync('unzip', ['-Z', '-1', zipPath], {
      encoding: 'utf8',
    });
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  private unzipFile(zipPath: string, entry: string): Buffer {
    return execFileSync('unzip', ['-p', zipPath, entry]);
  }
}
