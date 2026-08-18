import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EvaluationStore } from '../repositories/evaluation-store.repository';
import { sha256Hex } from '../utils/chatgpt-export.utils';
import {
  buildDerivedEvaluation,
  evaluationId,
} from '../utils/evaluation.utils';
import { EvaluationActor } from '../types';

const WHEN = '2026-08-18T22:00:00.000Z';
const NOTE = 'SYNTHETIC_EVALUATION_NOTE';

const evaluation = (
  overrides: Parameters<typeof buildDerivedEvaluation>[0] = {
    evaluatedRecordId: 'a'.repeat(64),
    evaluator: { type: 'human', name: 'fixture' },
    evaluatedAt: WHEN,
    recordedAt: WHEN,
    evidenceSupport: 'supported',
  },
) => buildDerivedEvaluation(overrides);

describe('EvaluationStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'evaluation-store-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes once and treats an identical rewrite as already-present', async () => {
    const store = new EvaluationStore();
    const record = evaluation();
    const path = await store.write(dir, record);
    const first = readFileSync(path, 'utf-8');
    await store.write(dir, { ...record });
    expect(readFileSync(path, 'utf-8')).toBe(first);
    expect(await store.read(dir, record.id)).toEqual(record);
  });

  it('refuses a same-id write with different identity-bearing contents', async () => {
    const store = new EvaluationStore();
    const record = evaluation();
    const path = await store.write(dir, record);
    const first = readFileSync(path, 'utf-8');
    await expect(
      store.write(dir, {
        ...record,
        evidenceSupport: 'uncertain',
      }),
    ).rejects.toThrow('evaluation-conflict:identity');
    expect(readFileSync(path, 'utf-8')).toBe(first);
  });

  it('refuses to overwrite a different recordedAt under the same id', async () => {
    const store = new EvaluationStore();
    const record = evaluation();
    const path = await store.write(dir, record);
    const first = readFileSync(path, 'utf-8');
    await expect(
      store.write(dir, {
        ...record,
        recordedAt: '2026-08-19T00:00:00.000Z',
      }),
    ).rejects.toThrow('evaluation-conflict:immutable');
    expect(readFileSync(path, 'utf-8')).toBe(first);
  });

  it('treats a modified stored identity field as invalid', async () => {
    const store = new EvaluationStore();
    const record = evaluation();
    const path = await store.write(dir, record);
    const dumped = JSON.parse(readFileSync(path, 'utf-8'));
    dumped.evidenceSupport = 'not-supported';
    writeFileSync(path, JSON.stringify(dumped, null, 2) + '\n');
    expect(await store.read(dir, record.id)).toBeNull();
    expect(await store.diagnose(dir, record.id)).toBe('invalid');
  });

  it('treats a modified note with a stale noteRef as invalid', async () => {
    const store = new EvaluationStore();
    const record = evaluation({
      evaluatedRecordId: 'a'.repeat(64),
      evaluator: { type: 'human', name: 'fixture' },
      evaluatedAt: WHEN,
      recordedAt: WHEN,
      evidenceSupport: 'supported',
      note: NOTE,
    });
    const path = await store.write(dir, record);
    expect(record.noteRef).toBe(sha256Hex(NOTE));
    const dumped = JSON.parse(readFileSync(path, 'utf-8'));
    dumped.note = 'SYNTHETIC_TAMPERED_NOTE';
    writeFileSync(path, JSON.stringify(dumped, null, 2) + '\n');
    expect(await store.read(dir, record.id)).toBeNull();
    expect(await store.diagnose(dir, record.id)).toBe('invalid');
  });

  it('refuses to replace a malformed existing file', async () => {
    const store = new EvaluationStore();
    const record = evaluation();
    writeFileSync(join(dir, `${record.id}.json`), '{not-json');
    await expect(store.write(dir, record)).rejects.toThrow(
      'evaluation-conflict:unreadable',
    );
    expect(readFileSync(join(dir, `${record.id}.json`), 'utf-8')).toBe(
      '{not-json',
    );
  });

  it('rejects a self-consistent file with an illegal schema value', async () => {
    const store = new EvaluationStore();
    const rec = {
      schemaVersion: 'derived-evaluation/1' as const,
      evaluatedRecordId: 'a'.repeat(64),
      evaluator: { type: 'human' as const, name: 'fixture' },
      evaluatedAt: WHEN,
      recordedAt: WHEN,
      evidenceSupport: 'banana',
    };
    const id = evaluationId({
      evaluatedRecordId: rec.evaluatedRecordId,
      evaluator: rec.evaluator as EvaluationActor,
      evaluatedAt: rec.evaluatedAt,
      evidenceSupport: rec.evidenceSupport as never,
    });
    writeFileSync(
      join(dir, `${id}.json`),
      JSON.stringify({ ...rec, id }, null, 2) + '\n',
    );
    expect(await store.read(dir, id)).toBeNull();
    expect(await store.diagnose(dir, id)).toBe('invalid');
  });

  it('rejects a self-consistent file with an unknown top-level field', async () => {
    const store = new EvaluationStore();
    const record = evaluation();
    const extra = {
      ...record,
      mysteryField: 'untracked-payload',
    };
    writeFileSync(
      join(dir, `${record.id}.json`),
      JSON.stringify(extra, null, 2) + '\n',
    );
    expect(await store.read(dir, record.id)).toBeNull();
    expect(await store.diagnose(dir, record.id)).toBe('invalid');
  });
});
