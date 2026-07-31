import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { injectable } from 'inversify';
import { parseNotes } from '../utils/notes.utils';

/**
 * Persistence adapter for the per-day, human-owned notes file. Resource access
 * only — no business logic.
 *
 * Notes are **authoritative input** (PRD-0003): the engineer edits
 * `<repoPath>/chronicles/notes/<date>.md` directly, and Chronicle reads it as
 * the source of truth. Unlike derived git/Claude activity, notes exist nowhere
 * else, so this file is never regenerated — synthesis only ever reads it.
 */
export interface INotesStore {
  /** Read the raw notes Markdown for `date` (YYYY-MM-DD), or null if absent. */
  readDaily(repoPath: string, date: string): Promise<string | null>;
  /**
   * Append `entry` (one or more lines) to the day's notes file, creating it if
   * needed. Lines whose content already exists in the file are skipped, so
   * repeated appends of the same note are idempotent.
   */
  appendDaily(repoPath: string, date: string, entry: string): Promise<void>;
}

const NOTES_DIR = path.join('chronicles', 'notes');

/**
 * Filesystem implementation of {@link INotesStore}.
 *
 * Stores one Markdown file per day under `<repoPath>/chronicles/notes/`. Appends
 * dedup by content-hash id (via {@link parseNotes}) against the existing file, so
 * live append-as-you-go and re-runs never double-write a note. Writing is
 * plain file I/O; committing the file is the ChronicleRepository's concern.
 */
@injectable()
export class NotesStore implements INotesStore {
  /** @inheritDoc */
  async readDaily(repoPath: string, date: string): Promise<string | null> {
    const absPath = path.join(repoPath, NOTES_DIR, `${date}.md`);
    if (!existsSync(absPath)) return null;
    return readFileSync(absPath, 'utf-8');
  }

  /** @inheritDoc */
  async appendDaily(
    repoPath: string,
    date: string,
    entry: string,
  ): Promise<void> {
    const absDir = path.join(repoPath, NOTES_DIR);
    const absPath = path.join(absDir, `${date}.md`);

    const existing = existsSync(absPath) ? readFileSync(absPath, 'utf-8') : '';
    const existingIds = new Set(parseNotes(existing).map((n) => n.id));

    // Keep only entry lines whose content is not already recorded.
    const fresh = parseNotes(entry).filter((n) => !existingIds.has(n.id));
    if (fresh.length === 0) return;

    const lines = fresh.map((n) =>
      n.time ? `- [${n.time}] ${n.text}` : `- ${n.text}`,
    );
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    const body = existing + prefix + lines.join('\n') + '\n';

    mkdirSync(absDir, { recursive: true });
    writeFileSync(absPath, body);
  }
}
