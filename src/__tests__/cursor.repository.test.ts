import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CursorRepository } from '../repositories/cursor.repository';
import { ChronicleWindow } from '../types';

const TMP_BASE = join(tmpdir(), `chronicle-cursor-test-${process.pid}`);

const WINDOW: ChronicleWindow = { start: '2026-07-22', end: '2026-07-22' };
const PROJECT = '/Users/test/projects/myapp';
const SLUG = 'Users-test-projects-myapp';

/** Epoch ms for a local time inside/outside the test window. */
const IN_WINDOW_MS = new Date('2026-07-22T10:00:00').getTime();
const OUT_OF_WINDOW_MS = new Date('2026-07-21T10:00:00').getTime();

const makeUser = (text: string) =>
  JSON.stringify({
    role: 'user',
    message: { content: [{ type: 'text', text }] },
  });

const makeAssistant = (text: string) =>
  JSON.stringify({
    role: 'assistant',
    message: { content: [{ type: 'text', text }] },
  });

const makeTurnEnded = () =>
  JSON.stringify({ type: 'turn_ended', status: 'success' });

const originalHome = process.env.HOME;
beforeAll(() => {
  mkdirSync(TMP_BASE, { recursive: true });
});
afterAll(() => {
  process.env.HOME = originalHome;
  rmSync(TMP_BASE, { recursive: true, force: true });
});

// Each test gets its own isolated HOME so sessions never bleed across tests.
let testHome: string;
let transcriptsDir: string;
let chatsDir: string;
let repo: CursorRepository;

beforeEach(() => {
  const id = Math.random().toString(36).slice(2);
  testHome = join(TMP_BASE, `home-${id}`);
  transcriptsDir = join(
    testHome,
    '.cursor',
    'projects',
    SLUG,
    'agent-transcripts',
  );
  chatsDir = join(testHome, '.cursor', 'chats', 'somecwdhash');
  process.env.HOME = testHome;
  repo = new CursorRepository();
});

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true });
});

function writeTranscript(sessionId: string, lines: string[]) {
  const dir = join(transcriptsDir, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n');
}

function writeMeta(
  sessionId: string,
  meta: { title?: string; createdAtMs?: number },
) {
  const dir = join(chatsDir, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({ schemaVersion: 1, cwd: PROJECT, ...meta }),
  );
}

/** Today's local date as YYYY-MM-DD, for birthtime-fallback tests. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

describe('CursorRepository.getActivity', () => {
  it('returns [] when the projects directory does not exist', async () => {
    expect(await repo.getActivity(WINDOW, PROJECT)).toEqual([]);
  });

  it('extracts a titled session in the window from meta.json', async () => {
    writeTranscript('sess-titled', [makeUser('do the thing'), makeTurnEnded()]);
    writeMeta('sess-titled', {
      title: 'Build the thing',
      createdAtMs: IN_WINDOW_MS,
    });

    const result = await repo.getActivity(WINDOW, PROJECT);
    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe('Build the thing');
    expect(result[0].source).toBe('cursor');
    expect(result[0].timestamp).toBe(new Date(IN_WINDOW_MS).toISOString());
    expect(result[0].reviewNeeded).toBeUndefined();
    expect(result[0].evidence[0].ref).toBe('sess-titled');
  });

  it('drops sessions created outside the window', async () => {
    writeTranscript('sess-old', [makeUser('old work')]);
    writeMeta('sess-old', {
      title: 'Old session',
      createdAtMs: OUT_OF_WINDOW_MS,
    });

    expect(await repo.getActivity(WINDOW, PROJECT)).toEqual([]);
  });

  it('falls back to file birthtime when meta.json is missing', async () => {
    // No meta.json — the transcript was just written, so its birthtime is now.
    writeTranscript('sess-no-meta', [makeUser('fresh work')]);

    const today = todayLocal();
    const result = await repo.getActivity(
      { start: today, end: today },
      PROJECT,
    );
    expect(result).toHaveLength(1);
    expect(result[0].summary).toContain('fresh work');
  });

  it('falls back to the first user prompt and sets reviewNeeded when untitled', async () => {
    const longPrompt = 'A'.repeat(200);
    writeTranscript('sess-untitled', [makeUser(longPrompt)]);
    writeMeta('sess-untitled', { createdAtMs: IN_WINDOW_MS });

    const result = await repo.getActivity(WINDOW, PROJECT);
    expect(result).toHaveLength(1);
    expect(result[0].reviewNeeded).toBe(true);
    expect(result[0].summary).toContain('[needs-review]');
    expect(result[0].summary.length).toBeLessThan(200);
  });

  it('unwraps the injected <user_query> envelope in fallback titles', async () => {
    const wrapped =
      '<user_info>\nOS Version: darwin\n</user_info>\n' +
      '<user_query>\nFix the login bug\n</user_query>';
    writeTranscript('sess-wrapped', [makeUser(wrapped)]);
    writeMeta('sess-wrapped', { createdAtMs: IN_WINDOW_MS });

    const result = await repo.getActivity(WINDOW, PROJECT);
    expect(result[0].summary).toBe('Fix the login bug [needs-review]');
  });

  it('strips injected tag blocks when there is no <user_query> envelope', async () => {
    const injected =
      '<external_links>\nnoise noise noise\n</external_links>\nplain prompt text';
    writeTranscript('sess-injected', [makeUser(injected)]);
    writeMeta('sess-injected', { createdAtMs: IN_WINDOW_MS });

    const result = await repo.getActivity(WINDOW, PROJECT);
    expect(result[0].summary).toBe('plain prompt text [needs-review]');
  });

  it('drops untitled sessions with no user prompt text', async () => {
    writeTranscript('sess-empty', [makeAssistant('hello'), makeTurnEnded()]);
    writeMeta('sess-empty', { createdAtMs: IN_WINDOW_MS });

    expect(await repo.getActivity(WINDOW, PROJECT)).toEqual([]);
  });

  it('does not surface subagent transcripts as separate sessions', async () => {
    writeTranscript('sess-parent', [makeUser('parent work')]);
    writeMeta('sess-parent', {
      title: 'Parent session',
      createdAtMs: IN_WINDOW_MS,
    });
    // Subagent transcript nested inside the parent session directory.
    const subDir = join(transcriptsDir, 'sess-parent', 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      join(subDir, 'sub-1.jsonl'),
      makeUser('subagent work') + '\n',
    );

    const result = await repo.getActivity(WINDOW, PROJECT);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('sess-parent');
  });

  it('handles malformed JSONL lines gracefully', async () => {
    writeTranscript('sess-corrupt', [
      'not valid json {{{',
      makeUser('real prompt'),
    ]);
    writeMeta('sess-corrupt', { createdAtMs: IN_WINDOW_MS });

    const result = await repo.getActivity(WINDOW, PROJECT);
    expect(result[0].summary).toBe('real prompt [needs-review]');
  });

  it('matches workspace-root sessions via slug prefix', async () => {
    // A session recorded under a deeper project slug still matches the root.
    const deepDir = join(
      testHome,
      '.cursor',
      'projects',
      `${SLUG}-subrepo`,
      'agent-transcripts',
      'sess-deep',
    );
    mkdirSync(deepDir, { recursive: true });
    writeFileSync(
      join(deepDir, 'sess-deep.jsonl'),
      makeUser('deep work') + '\n',
    );
    writeMeta('sess-deep', {
      title: 'Deep session',
      createdAtMs: IN_WINDOW_MS,
    });

    const result = await repo.getActivity(WINDOW, PROJECT);
    expect(result.some((a) => a.summary === 'Deep session')).toBe(true);
  });

  it('resolves a session date from meta.json createdAtMs', async () => {
    writeTranscript('sess-dated', [makeUser('work')]);
    writeMeta('sess-dated', { title: 'Dated', createdAtMs: IN_WINDOW_MS });

    expect(await repo.findSessionDate('sess-dated')).toBe('2026-07-22');
  });

  it('falls back to transcript birthtime for the session date when meta is missing', async () => {
    writeTranscript('sess-birth', [makeUser('work')]);

    expect(await repo.findSessionDate('sess-birth')).toBe(todayLocal());
  });

  it('returns null for an unknown session id', async () => {
    expect(await repo.findSessionDate('nope')).toBeNull();
  });

  it('returns sessions sorted by timestamp ascending', async () => {
    writeTranscript('sess-later', [makeUser('later')]);
    writeMeta('sess-later', {
      title: 'Later session',
      createdAtMs: new Date('2026-07-22T14:00:00').getTime(),
    });
    writeTranscript('sess-earlier', [makeUser('earlier')]);
    writeMeta('sess-earlier', {
      title: 'Earlier session',
      createdAtMs: new Date('2026-07-22T08:00:00').getTime(),
    });

    const result = await repo.getActivity(WINDOW, PROJECT);
    const titles = result.map((a) => a.summary);
    expect(titles.indexOf('Earlier session')).toBeLessThan(
      titles.indexOf('Later session'),
    );
  });
});
