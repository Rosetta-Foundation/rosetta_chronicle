import { createHash } from 'crypto';

/**
 * Pure helpers for parsing free-form note text. No I/O, no DI — shared by the
 * notes source repository (which turns notes into Activity) and the notes store
 * (which dedups them on append), so both use one definition of "a note entry"
 * and one stable id. See PRD-0003.
 */

/**
 * `- [14:32] text` / `* text` / `text` — capture optional time and the body.
 * A leading bullet is only treated as a bullet when followed by whitespace, so a
 * lone `-`/`*` line has no body and is rejected (see the guard in parseNotes).
 */
export const NOTE_ENTRY = /^\s*(?:[-*]\s+)?(?:\[(\d{2}:\d{2})\]\s*)?(.+?)\s*$/;

/** A line that is nothing but a bullet marker — not a note. */
const BULLET_ONLY = /^\s*[-*]\s*$/;

/** Stable id for a note entry from its normalized text (the dedup key). */
export const noteId = (text: string): string =>
  createHash('sha1').update(text).digest('hex').slice(0, 12);

/** A single parsed note entry. */
export interface ParsedNote {
  /** Content-hash id of the note text (stable dedup key). */
  id: string;
  /** Optional `HH:MM` time captured from a `[HH:MM]` prefix. */
  time?: string;
  /** The note body, bullet prefix and time stripped. */
  text: string;
}

/**
 * Parse free-form note text into deduplicated entries, one per non-empty line,
 * preserving first-seen order. Identical note bodies collapse to a single entry
 * (by content-hash id), which is what makes re-ingest and append-as-you-go
 * idempotent.
 */
export const parseNotes = (notes: string): ParsedNote[] => {
  const seen = new Set<string>();
  const out: ParsedNote[] = [];
  for (const line of notes.split('\n')) {
    if (BULLET_ONLY.test(line)) continue; // a lone bullet is not a note
    const match = NOTE_ENTRY.exec(line);
    if (!match) continue;
    const text = match[2].trim();
    if (text.length === 0) continue;
    const id = noteId(text);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(match[1] ? { id, time: match[1], text } : { id, text });
  }
  return out;
};
