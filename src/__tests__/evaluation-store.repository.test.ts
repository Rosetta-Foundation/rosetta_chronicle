import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EvaluationStore } from '../repositories/evaluation-store.repository';
import { DerivedEvaluation } from '../types';

const evaluation = (): DerivedEvaluation => ({
  schemaVersion: 'derived-evaluation/1',
  id: 'c'.repeat(64),
  evaluatedRecordId: 'a'.repeat(64),
  evaluator: { type: 'human', name: 'fixture' },
  evaluatedAt: '2026-08-18T22:00:00.000Z',
  recordedAt: '2026-08-18T22:00:00.000Z',
  evidenceSupport: 'supported',
});

describe('EvaluationStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'evaluation-store-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes and reads an evaluation', async () => {
    const store = new EvaluationStore();
    const record = evaluation();
    const path = await store.write(dir, record);
    expect(JSON.parse(readFileSync(path, 'utf-8')).id).toBe(record.id);
    expect(await store.read(dir, record.id)).toEqual(record);
    expect(await store.list(dir)).toEqual([record]);
  });

  it('diagnoses missing and invalid ids', async () => {
    const store = new EvaluationStore();
    expect(await store.diagnose(dir, 'nope')).toBe('invalid');
    expect(await store.diagnose(dir, 'd'.repeat(64))).toBe('missing');
  });
});
