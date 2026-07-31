import { parseNotes, noteId, NOTE_ENTRY } from '../utils/notes.utils';

describe('notes.utils', () => {
  describe('noteId', () => {
    it('is stable for identical text and differs for different text', () => {
      expect(noteId('hello')).toBe(noteId('hello'));
      expect(noteId('hello')).not.toBe(noteId('world'));
    });
  });

  describe('NOTE_ENTRY', () => {
    it('captures an optional time and the body, stripping bullets', () => {
      expect(NOTE_ENTRY.exec('- [14:32] standup')?.[1]).toBe('14:32');
      expect(NOTE_ENTRY.exec('- [14:32] standup')?.[2]).toBe('standup');
      expect(NOTE_ENTRY.exec('* just text')?.[2]).toBe('just text');
      expect(NOTE_ENTRY.exec('no bullet')?.[2]).toBe('no bullet');
    });
  });

  describe('parseNotes', () => {
    it('returns one entry per non-empty line, preserving order', () => {
      const notes = parseNotes('- one\n- two\n\n- three');
      expect(notes.map((n) => n.text)).toEqual(['one', 'two', 'three']);
    });

    it('dedups identical bodies by content-hash id', () => {
      const notes = parseNotes('- dup\n- dup\n- unique');
      expect(notes.map((n) => n.text)).toEqual(['dup', 'unique']);
    });

    it('extracts the [HH:MM] time when present', () => {
      const [note] = parseNotes('- [09:15] morning sync');
      expect(note.time).toBe('09:15');
      expect(note.text).toBe('morning sync');
    });

    it('omits time when absent', () => {
      const [note] = parseNotes('- undated');
      expect(note.time).toBeUndefined();
    });

    it('skips blank and bullet-only lines', () => {
      expect(parseNotes('\n\n-\n  \n- real')).toHaveLength(1);
    });
  });
});
