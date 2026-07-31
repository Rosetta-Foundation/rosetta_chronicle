import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { ChronicleStore } from '../repositories/chronicle-store.repository';
import { DailyChronicleData } from '../types';

const DATE = '2026-07-22';
const data = (tags: DailyChronicleData['tags']): DailyChronicleData => ({
  window: { start: DATE, end: DATE },
  tags,
  activities: [
    {
      source: 'git',
      id: 'abc',
      timestamp: `${DATE}T10:00:00Z`,
      summary: 'feat: x',
      repo: 'repo-a',
      evidence: [{ source: 'git', ref: 'abc', description: 'abc feat: x' }],
    },
  ],
});

describe('ChronicleStore', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(path.join(tmpdir(), 'chronicle-store-'));
  });
  afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

  it('readDaily returns null when no sidecar exists', async () => {
    const store = new ChronicleStore();
    expect(await store.readDaily(repoDir, DATE)).toBeNull();
  });

  it('round-trips structured data through write then read', async () => {
    const store = new ChronicleStore();
    await store.writeDaily(repoDir, data(['DELIVERY', 'ARCH']));

    const read = await store.readDaily(repoDir, DATE);
    expect(read).not.toBeNull();
    expect(read!.tags).toEqual(['DELIVERY', 'ARCH']);
    expect(read!.activities[0].repo).toBe('repo-a');
    expect(read!.activities[0].summary).toBe('feat: x');
  });

  it('writes under chronicles/.data/<date>.json', async () => {
    const store = new ChronicleStore();
    await store.writeDaily(repoDir, data(['DEV']));
    const expected = path.join(repoDir, 'chronicles', '.data', `${DATE}.json`);
    expect(require('fs').existsSync(expected)).toBe(true);
  });

  it('overwrites on a repeat write (regenerable cache)', async () => {
    const store = new ChronicleStore();
    await store.writeDaily(repoDir, data(['DELIVERY']));
    await store.writeDaily(repoDir, data(['DELIVERY', 'SECURITY']));
    const read = await store.readDaily(repoDir, DATE);
    expect(read!.tags).toEqual(['DELIVERY', 'SECURITY']);
  });

  it('returns null for a corrupt sidecar rather than throwing', async () => {
    const dir = path.join(repoDir, 'chronicles', '.data');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${DATE}.json`), '{ not valid json');

    const store = new ChronicleStore();
    expect(await store.readDaily(repoDir, DATE)).toBeNull();
  });
});
