import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ClaudeCodeRepository } from '../repositories/claude-code.repository';
import { ChronicleWindow } from '../types';

const TMP_BASE = join(tmpdir(), `chronicle-cc-test-${process.pid}`);

const SESSION_IN_WINDOW = '2026-07-22T10:00:00.000Z';
const SESSION_OUT_OF_WINDOW = '2026-07-21T10:00:00.000Z';

const makeUser = (ts: string, prompt?: string) => {
  const record: Record<string, unknown> = {
    type: 'user',
    timestamp: ts,
    cwd: '/Users/test/projects/myapp',
    gitBranch: 'main',
    sessionId: 'test-session',
  };
  if (prompt) {
    record['message'] = { content: [{ type: 'text', text: prompt }] };
  }
  return JSON.stringify(record);
};

const makeAiTitle = (title: string) =>
  JSON.stringify({ type: 'ai-title', aiTitle: title, sessionId: 'test-session' });

const makePrLink = (repo: string, num: number, url: string) =>
  JSON.stringify({
    type: 'pr-link',
    prRepository: repo,
    prNumber: num,
    prUrl: url,
    sessionId: 'test-session',
    timestamp: SESSION_IN_WINDOW,
  });

const makeNoise = () =>
  JSON.stringify({ type: 'mode', mode: 'auto', sessionId: 'test-session' });

function writeSession(dir: string, sessionId: string, lines: string[]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n');
}

const originalHome = process.env.HOME;
beforeAll(() => { mkdirSync(TMP_BASE, { recursive: true }); });
afterAll(() => {
  process.env.HOME = originalHome;
  rmSync(TMP_BASE, { recursive: true, force: true });
});

// Each test gets its own isolated HOME so sessions never bleed across tests.
let testHome: string;
let projectDir: string;
let repo: ClaudeCodeRepository;

beforeEach(() => {
  const id = Math.random().toString(36).slice(2);
  testHome = join(TMP_BASE, `home-${id}`);
  projectDir = join(testHome, '.claude', 'projects', `-Users-test-projects-myapp`);
  process.env.HOME = testHome;
  repo = new ClaudeCodeRepository();
});

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true });
});

const window: ChronicleWindow = { start: '2026-07-22', end: '2026-07-22' };
const PROJECT = '/Users/test/projects/myapp';

describe('ClaudeCodeRepository.getActivity', () => {
  it('returns [] when the projects directory does not exist', async () => {
    expect(await repo.getActivity(window, PROJECT)).toEqual([]);
  });

  it('returns [] when no sessions fall in the window', async () => {
    writeSession(projectDir, 'sess-old', [
      makeUser(SESSION_OUT_OF_WINDOW, 'old work'),
      makeAiTitle('Old session'),
    ]);
    expect(await repo.getActivity(window, PROJECT)).toEqual([]);
  });

  it('extracts a titled session in the window', async () => {
    writeSession(projectDir, 'sess-titled', [
      makeNoise(),
      makeUser(SESSION_IN_WINDOW, 'first prompt'),
      makeAiTitle('Build the thing'),
    ]);
    const result = await repo.getActivity(window, PROJECT);
    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe('Build the thing');
    expect(result[0].source).toBe('claude-code');
    expect(result[0].reviewNeeded).toBeUndefined();
  });

  it('uses the last ai-title (post-compaction)', async () => {
    writeSession(projectDir, 'sess-multi-title', [
      makeUser(SESSION_IN_WINDOW, 'early prompt'),
      makeAiTitle('Early title'),
      makeUser('2026-07-22T15:00:00.000Z', 'later prompt'),
      makeAiTitle('Updated title after compaction'),
    ]);
    const result = await repo.getActivity(window, PROJECT);
    expect(result[0].summary).toBe('Updated title after compaction');
  });

  it('falls back to truncated first prompt and sets reviewNeeded', async () => {
    const longPrompt = 'A'.repeat(200);
    writeSession(projectDir, 'sess-no-title', [
      makeUser(SESSION_IN_WINDOW, longPrompt),
    ]);
    const result = await repo.getActivity(window, PROJECT);
    expect(result).toHaveLength(1);
    expect(result[0].reviewNeeded).toBe(true);
    expect(result[0].summary).toContain('[needs-review]');
    expect(result[0].summary.length).toBeLessThan(200);
  });

  it('drops sessions with no user records in window and no title', async () => {
    writeSession(projectDir, 'sess-noise-only', [makeNoise(), makeNoise()]);
    expect(await repo.getActivity(window, PROJECT)).toEqual([]);
  });

  it('includes deduplicated PR evidence', async () => {
    writeSession(projectDir, 'sess-with-prs', [
      makeUser(SESSION_IN_WINDOW, 'work'),
      makeAiTitle('Ship feature X'),
      makePrLink('org/repo', 42, 'https://github.com/org/repo/pull/42'),
      makePrLink('org/repo', 42, 'https://github.com/org/repo/pull/42'), // duplicate
      makePrLink('org/repo', 43, 'https://github.com/org/repo/pull/43'),
    ]);
    const result = await repo.getActivity(window, PROJECT);
    const prEvidence = result[0].evidence.filter((e) => e.ref.includes('#'));
    expect(prEvidence).toHaveLength(2);
    expect(prEvidence[0].ref).toBe('org/repo#42');
    expect(prEvidence[1].ref).toBe('org/repo#43');
  });

  it('anchors timestamp to first in-window user record', async () => {
    writeSession(projectDir, 'sess-timestamps', [
      makeUser(SESSION_OUT_OF_WINDOW, 'pre-window'),
      makeUser('2026-07-22T09:30:00.000Z', 'first in window'),
      makeUser('2026-07-22T11:00:00.000Z', 'second in window'),
      makeAiTitle('Multi-day session'),
    ]);
    const result = await repo.getActivity(window, PROJECT);
    expect(result[0].timestamp).toBe('2026-07-22T09:30:00.000Z');
  });

  it('matches workspace-root sessions via cwd-prefix', async () => {
    // Session launched from workspace root — same prefix, deeper slug would also match
    const rootDir = join(testHome, '.claude', 'projects', `-Users-test-projects-myapp`);
    writeSession(rootDir, 'sess-root', [
      makeUser(SESSION_IN_WINDOW, 'root session'),
      makeAiTitle('Root workspace session'),
    ]);
    const result = await repo.getActivity(window, PROJECT);
    expect(result.some((a) => a.summary === 'Root workspace session')).toBe(true);
  });

  it('returns sessions sorted by timestamp ascending', async () => {
    const secondDir = join(testHome, '.claude', 'projects', `-Users-test-projects-myapp-sub`);
    writeSession(projectDir, 'sess-later', [
      makeUser('2026-07-22T14:00:00.000Z'),
      makeAiTitle('Later session'),
    ]);
    writeSession(secondDir, 'sess-earlier', [
      makeUser('2026-07-22T08:00:00.000Z'),
      makeAiTitle('Earlier session'),
    ]);
    const result = await repo.getActivity(window, PROJECT);
    const titles = result.map((a) => a.summary);
    expect(titles.indexOf('Earlier session')).toBeLessThan(titles.indexOf('Later session'));
  });

  it('handles malformed JSONL lines gracefully', async () => {
    writeSession(projectDir, 'sess-corrupt', [
      'not valid json {{{',
      makeUser(SESSION_IN_WINDOW, 'real prompt'),
      makeAiTitle('Survives corrupt lines'),
    ]);
    const result = await repo.getActivity(window, PROJECT);
    expect(result[0].summary).toBe('Survives corrupt lines');
  });
});
