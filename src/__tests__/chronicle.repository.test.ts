import { execFileSync } from 'child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { ChronicleRepository } from '../repositories/chronicle.repository';
import { DailyChronicle } from '../types';

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

const chronicle = (markdown: string): DailyChronicle => ({
  window: { start: '2026-07-22', end: '2026-07-22' },
  sections: [],
  tags: [],
  markdown,
  data: {
    window: { start: '2026-07-22', end: '2026-07-22' },
    tags: [],
    activities: [],
  },
});

describe('ChronicleRepository.readDaily', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(path.join(tmpdir(), 'chronicle-read-'));
  });
  afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

  it('returns null when no chronicle file exists for the date', async () => {
    const repo = new ChronicleRepository();
    expect(await repo.readDaily(repoDir, '2026-07-22')).toBeNull();
  });

  it('returns the file contents when it exists', async () => {
    const repo = new ChronicleRepository();
    // Write via persistDaily (non-git dir, but the file is still written)
    await repo.persistDaily(repoDir, chronicle('# hello'));
    expect(await repo.readDaily(repoDir, '2026-07-22')).toBe('# hello');
  });
});

describe('ChronicleRepository.persistDaily', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(path.join(tmpdir(), 'chronicle-persist-'));
    git(repoDir, ['init', '-q']);
    git(repoDir, ['config', 'user.email', 'test@example.com']);
    git(repoDir, ['config', 'user.name', 'Test User']);
    git(repoDir, ['config', 'commit.gpgsign', 'false']);
  });

  afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

  it('writes the markdown to chronicles/<date>.md and commits it', async () => {
    const repo = new ChronicleRepository();
    const result = await repo.persistDaily(
      repoDir,
      chronicle('# Daily Chronicle\n\nhello'),
    );

    const expectedPath = path.join(repoDir, 'chronicles', '2026-07-22.md');
    expect(result.path).toBe(expectedPath);
    expect(result.committed).toBe(true);
    expect(existsSync(expectedPath)).toBe(true);
    expect(readFileSync(expectedPath, 'utf-8')).toContain('# Daily Chronicle');

    // Machine-authored ledger commit per ADR-0007: chronicle(daily) subject
    // plus mandatory provenance trailers.
    const message = git(repoDir, ['log', '-1', '--format=%B']);
    expect(message).toContain('chronicle(daily): 2026-07-22');
    expect(message).toContain('Chronicle-Window: 2026-07-22');
    expect(message).toMatch(/Generated-By: chronicle@\d+\.\d+\.\d+/);

    // The trailers parse as real git trailers, not just body text.
    const trailers = execFileSync('git', ['interpret-trailers', '--parse'], {
      input: message,
      encoding: 'utf-8',
    });
    expect(trailers).toContain('Chronicle-Window: 2026-07-22');
  });

  it('overwrites an existing chronicle on a repeat run (idempotent path/name)', async () => {
    const repo = new ChronicleRepository();
    await repo.persistDaily(repoDir, chronicle('first'));
    const result = await repo.persistDaily(repoDir, chronicle('second'));

    const written = readFileSync(result.path, 'utf-8');
    expect(written).toBe('second');
  });

  it('second persist of identical content reports committed=false (nothing to commit)', async () => {
    const repo = new ChronicleRepository();
    await repo.persistDaily(repoDir, chronicle('same content'));
    const result = await repo.persistDaily(repoDir, chronicle('same content'));
    expect(result.committed).toBe(false); // no-op: nothing staged
  });

  it('still writes the file but reports committed=false when path is not a git repo', async () => {
    const nonRepo = mkdtempSync(path.join(tmpdir(), 'chronicle-nonrepo-'));
    try {
      const repo = new ChronicleRepository();
      const result = await repo.persistDaily(nonRepo, chronicle('no git here'));
      expect(existsSync(result.path)).toBe(true);
      expect(result.committed).toBe(false);
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  it('commits the sidecar and notes files alongside the markdown when present', async () => {
    // Simulate the handler having written the day's sibling artifacts first.
    const dataDir = path.join(repoDir, 'chronicles', '.data');
    const notesDir = path.join(repoDir, 'chronicles', 'notes');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(notesDir, { recursive: true });
    writeFileSync(path.join(dataDir, '2026-07-22.json'), '{"tags":[]}\n');
    writeFileSync(path.join(notesDir, '2026-07-22.md'), '- a note\n');

    const repo = new ChronicleRepository();
    const result = await repo.persistDaily(repoDir, chronicle('# render'));
    expect(result.committed).toBe(true);

    // All three paths are tracked in the resulting commit.
    const files = git(repoDir, ['show', '--name-only', '--format=', 'HEAD']);
    expect(files).toContain('chronicles/2026-07-22.md');
    expect(files).toContain('chronicles/.data/2026-07-22.json');
    expect(files).toContain('chronicles/notes/2026-07-22.md');
    // Nothing left uncommitted for the day.
    expect(git(repoDir, ['status', '--porcelain']).trim()).toBe('');
  });
});
