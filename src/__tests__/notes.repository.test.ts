import { NotesRepository } from '../repositories/notes.repository';
import { ChronicleWindow } from '../types';

const window: ChronicleWindow = { start: '2026-07-22', end: '2026-07-22' };

describe('NotesRepository.getActivity', () => {
  const repo = new NotesRepository();

  it('returns [] when there are no notes', async () => {
    expect(await repo.getActivity(window)).toEqual([]);
    expect(await repo.getActivity(window, '')).toEqual([]);
  });

  it('parses bullet and plain lines into note activities', async () => {
    const notes = ['- discussed federation with Vinay', '* reviewed ADR-0002', 'plain line'].join(
      '\n',
    );
    const activities = await repo.getActivity(window, notes);
    expect(activities.map((a) => a.summary)).toEqual([
      'discussed federation with Vinay',
      'reviewed ADR-0002',
      'plain line',
    ]);
    expect(activities.every((a) => a.source === 'notes')).toBe(true);
  });

  it('honors an explicit [HH:MM] time in the timestamp', async () => {
    const [a] = await repo.getActivity(window, '- [14:32] paired with Sam');
    expect(a.timestamp).toBe('2026-07-22T14:32:00');
    expect(a.summary).toBe('paired with Sam');
  });

  it('anchors undated notes to the window start', async () => {
    const [a] = await repo.getActivity(window, '- no time here');
    expect(a.timestamp).toBe('2026-07-22T00:00:00');
  });

  it('deduplicates identical note text within one ingest (stable id)', async () => {
    const activities = await repo.getActivity(window, ['- same note', '- same note'].join('\n'));
    expect(activities).toHaveLength(1);
  });

  it('gives each entry evidence tracing back to itself', async () => {
    const [a] = await repo.getActivity(window, '- something happened');
    expect(a.evidence).toHaveLength(1);
    expect(a.evidence[0].source).toBe('notes');
    expect(a.evidence[0].ref).toBe(a.id);
  });

  it('skips blank and whitespace-only lines', async () => {
    const activities = await repo.getActivity(window, ['- real', '', '   ', '- also real'].join('\n'));
    expect(activities.map((a) => a.summary)).toEqual(['real', 'also real']);
  });
});
