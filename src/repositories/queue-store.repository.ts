import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { injectable } from 'inversify';
import { QueueItem } from '../types';
import { parseQueue, serializeQueue } from '../utils/queue.utils';

/**
 * Persistence adapter for the personal work queue. Resource access only — no
 * business logic.
 *
 * The queue lives at `<repoPath>/chronicles/queue.md` — a human-editable
 * Markdown file with tagged checkbox items. It is **authoritative input**
 * (same contract as the notes file from PRD-0003): the engineer edits it
 * directly and Chronicle reads it as the source of truth. It is never
 * regenerated or overwritten by Chronicle synthesis.
 */
export interface IQueueStore {
  /** Read all queue items from the queue file. Returns [] when absent. */
  read(repoPath: string): Promise<QueueItem[]>;
  /** Write the full queue back to disk (overwrites; preserves hand-edits on round-trip). */
  write(repoPath: string, items: QueueItem[]): Promise<void>;
  /**
   * Append a new item to the queue. Items whose id already exists in the file
   * are skipped, so repeated calls are idempotent. New items land in Inbox.
   */
  append(repoPath: string, item: QueueItem): Promise<void>;
}

const QUEUE_PATH = path.join('chronicles', 'queue.md');

/**
 * Filesystem implementation of {@link IQueueStore}.
 *
 * Reads and writes `chronicles/queue.md` as structured Markdown. The format
 * is human-readable first — tags and section headings are the machine-readable
 * layer on top of plain Markdown.
 */
@injectable()
export class QueueStore implements IQueueStore {
  /** @inheritDoc */
  async read(repoPath: string): Promise<QueueItem[]> {
    const absPath = path.join(repoPath, QUEUE_PATH);
    if (!existsSync(absPath)) return [];
    const raw = readFileSync(absPath, 'utf-8');
    return parseQueue(raw);
  }

  /** @inheritDoc */
  async write(repoPath: string, items: QueueItem[]): Promise<void> {
    const absDir = path.join(repoPath, 'chronicles');
    const absPath = path.join(repoPath, QUEUE_PATH);
    mkdirSync(absDir, { recursive: true });
    writeFileSync(absPath, serializeQueue(items));
  }

  /** @inheritDoc */
  async append(repoPath: string, item: QueueItem): Promise<void> {
    const existing = await this.read(repoPath);
    if (existing.some((i) => i.id === item.id)) return;
    await this.write(repoPath, [...existing, item]);
  }
}
