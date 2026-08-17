import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { DerivedRecordStore } from '../repositories/derived-record-store.repository';
import { DerivedRecord } from '../types';

const ID = 'c'.repeat(64);

const record = (): DerivedRecord => ({
  id: ID,
  sourceRefs: [{ sourceGraphHash: 'a'.repeat(64), nodeIds: [] }],
  transformationType: 'human-note',
  transformationVersion: 'derived-record/1',
  createdAt: '2026-08-17T21:00:00.000Z',
  createdBy: { type: 'human', name: 'fixture' },
  contentRef: 'd'.repeat(64),
  content: 'SYNTHETIC_DERIVED_NOTE',
  reviewState: 'recognized',
});

describe('DerivedRecordStore', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = mkdtempSync(path.join(tmpdir(), 'derived-store-'));
  });
  afterEach(() => rmSync(outputDir, { recursive: true, force: true }));

  it('round-trips under outputDir/id.json with no personal layout', async () => {
    const store = new DerivedRecordStore();
    const written = await store.write(outputDir, record());
    expect(written).toBe(path.join(outputDir, `${ID}.json`));
    expect(existsSync(written)).toBe(true);
    expect(
      existsSync(path.join(outputDir, 'chronicles', '.data')),
    ).toBe(false);
    const read = await store.read(outputDir, ID);
    expect(read?.content).toBe('SYNTHETIC_DERIVED_NOTE');
  });
});
