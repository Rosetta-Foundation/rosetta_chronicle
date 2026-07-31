import { injectable } from 'inversify';
import { Activity, ChronicleWindow } from '../types';
import { parseNotes } from '../utils/notes.utils';

/**
 * Source adapter for manual engineer notes. Resource access only — no business
 * logic.
 *
 * Notes are free-form lines, one entry per line, optionally bullet-prefixed and
 * optionally carrying a `[HH:MM]` time. Each entry becomes an Activity with a
 * content-derived stable id, so the same note ingested twice does not duplicate
 * — the property live sourcing (append-as-you-go) relies on. The authoritative
 * source of the note text is the per-day notes file (see NotesStore, PRD-0003);
 * this repository turns whatever text it is handed into Activity records.
 */
export interface INotesRepository {
  /** Parse free-form notes for the window into activity records. */
  getActivity(window: ChronicleWindow, notes?: string): Promise<Activity[]>;
}

/**
 * Parsing implementation of {@link INotesRepository}.
 *
 * Delegates the "what is a note entry" and content-hash dedup rules to
 * {@link parseNotes} (shared with the notes store), then anchors each entry to a
 * timestamp: an explicit `[HH:MM]` time folds into the window start date;
 * undated notes anchor to the start of the day.
 */
@injectable()
export class NotesRepository implements INotesRepository {
  /** @inheritDoc */
  async getActivity(
    window: ChronicleWindow,
    notes?: string,
  ): Promise<Activity[]> {
    if (!notes) return [];

    return parseNotes(notes).map((note) => {
      // Anchor undated notes to the window start; fold in an explicit time.
      const timestamp = note.time
        ? `${window.start}T${note.time}:00`
        : `${window.start}T00:00:00`;

      return {
        source: 'notes',
        id: note.id,
        timestamp,
        summary: note.text,
        evidence: [
          { source: 'notes', ref: note.id, description: `note: ${note.text}` },
        ],
      } satisfies Activity;
    });
  }
}
