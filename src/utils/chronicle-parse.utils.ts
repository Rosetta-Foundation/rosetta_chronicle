import { Tag } from '../types';
import { ALL_TAGS } from './tags.utils';

/**
 * Pure helpers for extracting structured data from an existing Chronicle
 * Markdown document. Used to merge prior state into a fresh regeneration so
 * that tags and notes are never silently dropped.
 */

/**
 * Extract the set of tags from a rendered Chronicle Markdown string.
 * Matches lines of the form: `[TAG]` `[TAG]` …
 */
export const parseExistingTags = (markdown: string): Tag[] => {
  const tagSet = new Set(ALL_TAGS as readonly string[]);
  const found: Tag[] = [];
  for (const line of markdown.split('\n')) {
    const matches = line.matchAll(/`\[([A-Z-]+)\]`/g);
    for (const m of matches) {
      const candidate = m[1];
      if (tagSet.has(candidate) && !found.includes(candidate as Tag)) {
        found.push(candidate as Tag);
      }
    }
  }
  return found;
};

/**
 * Extract note lines from the `## Notes & Discussions` section of a rendered
 * Chronicle Markdown string. Returns raw note text strings (bullet prefix stripped).
 *
 * As of PRD-0003 notes are authoritative input read from the per-day notes file,
 * so this is **no longer on the preservation critical path**. It survives only
 * as the one-time migration helper that lifts notes out of a pre-PRD-0003
 * rendered Chronicle into the notes file; new notes never round-trip through
 * rendered Markdown.
 */
export const parseExistingNotes = (markdown: string): string[] => {
  const lines = markdown.split('\n');
  let inNotes = false;
  const notes: string[] = [];

  for (const line of lines) {
    if (/^## Notes & Discussions/.test(line)) {
      inNotes = true;
      continue;
    }
    if (inNotes) {
      if (/^## /.test(line)) break; // next section
      const match = /^\s*[-*]?\s*(.+?)\s*$/.exec(line);
      if (match && match[1].trim().length > 0) {
        notes.push(match[1].trim());
      }
    }
  }

  return notes;
};
