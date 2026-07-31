import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { NotesStore } from '../repositories/notes-store.repository';

const notePath = (repo: string, date: string) =>
  path.join(repo, 'chronicles', 'notes', `${date}.md`);

describe('NotesStore', () => {
  let repoDir: string;
  const DATE = '2026-07-22';

  beforeEach(() => {
    repoDir = mkdtempSync(path.join(tmpdir(), 'chronicle-notes-'));
  });
  afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

  it('readDaily returns null when no notes file exists', async () => {
    const store = new NotesStore();
    expect(await store.readDaily(repoDir, DATE)).toBeNull();
  });

  it('appendDaily creates the file and readDaily returns it', async () => {
    const store = new NotesStore();
    await store.appendDaily(repoDir, DATE, '- first note');

    expect(existsSync(notePath(repoDir, DATE))).toBe(true);
    const stored = await store.readDaily(repoDir, DATE);
    expect(stored).toContain('first note');
  });

  it('appends new notes without dropping existing ones', async () => {
    const store = new NotesStore();
    await store.appendDaily(repoDir, DATE, '- first note');
    await store.appendDaily(repoDir, DATE, '- second note');

    const stored = (await store.readDaily(repoDir, DATE)) ?? '';
    expect(stored).toContain('first note');
    expect(stored).toContain('second note');
  });

  it('dedups identical note content on re-append (idempotent)', async () => {
    const store = new NotesStore();
    await store.appendDaily(repoDir, DATE, '- same note');
    await store.appendDaily(repoDir, DATE, '- same note');

    const stored = readFileSync(notePath(repoDir, DATE), 'utf-8');
    const occurrences = stored.split('same note').length - 1;
    expect(occurrences).toBe(1);
  });

  it('preserves an explicit [HH:MM] time on the appended line', async () => {
    const store = new NotesStore();
    await store.appendDaily(repoDir, DATE, '[14:32] timed note');

    const stored = readFileSync(notePath(repoDir, DATE), 'utf-8');
    expect(stored).toContain('[14:32] timed note');
  });

  it('appends multiple lines in one call', async () => {
    const store = new NotesStore();
    await store.appendDaily(repoDir, DATE, '- note a\n- note b');

    const stored = (await store.readDaily(repoDir, DATE)) ?? '';
    expect(stored).toContain('note a');
    expect(stored).toContain('note b');
  });
});
