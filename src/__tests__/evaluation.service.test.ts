import 'reflect-metadata';
import { Container } from 'inversify';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DerivedRecordInput, EvaluateDerivedInput } from '../types';

const { CHRONICLE_TOKENS } = require('../tokens');
const {
  EvaluationService,
} = require('../services/evaluation.service');
const {
  DerivedRecordService,
} = require('../services/derived-record.service');
const {
  DerivedRecordStore,
} = require('../repositories/derived-record-store.repository');
const {
  EvaluationStore,
} = require('../repositories/evaluation-store.repository');
const {
  ChatGptGraphStore,
} = require('../repositories/chatgpt-graph-store.repository');

const HASH = 'b'.repeat(64);
const CREATED = '2026-08-17T21:00:00.000Z';
const WHEN = '2026-08-18T22:00:00.000Z';
const NOTE = 'SYNTHETIC_EVALUATION_NOTE';

const derivedInput = (
  outputDir: string,
  content: string,
): DerivedRecordInput => ({
  outputDir,
  sourceGraphHash: HASH,
  conversationId: 'conv-1',
  nodeIds: ['n1'],
  transformationType: 'human-note',
  createdBy: { type: 'human', name: 'fixture' },
  content,
  createdAt: CREATED,
  reviewState: 'unreviewed',
});

describe('EvaluationService', () => {
  let outputDir: string;
  let evaluationsDir: string;
  let derived: {
    record: (input: DerivedRecordInput) => Promise<Record<string, unknown>>;
  };
  let evaluate: {
    evaluate: (input: EvaluateDerivedInput) => Promise<Record<string, unknown>>;
  };

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'eval-derived-'));
    evaluationsDir = mkdtempSync(join(tmpdir(), 'eval-store-'));
    const container = new Container();
    container.bind(CHRONICLE_TOKENS.DerivedRecordStore).to(DerivedRecordStore);
    container.bind(CHRONICLE_TOKENS.EvaluationStore).to(EvaluationStore);
    container.bind(CHRONICLE_TOKENS.ChatGptGraphStore).to(ChatGptGraphStore);
    container
      .bind(CHRONICLE_TOKENS.DerivedRecordService)
      .to(DerivedRecordService);
    container.bind(CHRONICLE_TOKENS.EvaluationService).to(EvaluationService);
    derived = container.get(CHRONICLE_TOKENS.DerivedRecordService);
    evaluate = container.get(CHRONICLE_TOKENS.EvaluationService);
  });
  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
    rmSync(evaluationsDir, { recursive: true, force: true });
  });

  const recordMachine = (content: string) =>
    derived.record(derivedInput(outputDir, content));

  it('supports a machine observation without mutating it', async () => {
    const recorded = await recordMachine('SYNTHETIC_MACHINE_X');
    const result = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: recorded.id as string,
      evaluatorName: 'operator',
      evidenceSupport: 'supported',
      evaluatedAt: WHEN,
      recordedAt: WHEN,
    });
    expect(result.status).toBe('recorded');
    expect(result.evidenceSupport).toBe('supported');
    expect(result).not.toHaveProperty('note');
    const derivedFile = JSON.parse(
      readFileSync(join(outputDir, `${recorded.id}.json`), 'utf-8'),
    );
    expect(derivedFile.reviewState).toBe('unreviewed');
    expect(derivedFile.content).toBe('SYNTHETIC_MACHINE_X');
    expect(existsSync(join(evaluationsDir, 'chronicles'))).toBe(false);
  });

  it('rejects, marks uncertain, and keeps dimensions independent', async () => {
    const recorded = await recordMachine('SYNTHETIC_MACHINE_Y');
    const rejected = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: recorded.id as string,
      evaluatorName: 'operator',
      evidenceSupport: 'not-supported',
      personalRecognition: 'rejected',
      evaluatedAt: WHEN,
    });
    expect(rejected.status).toBe('recorded');
    expect(rejected.evidenceSupport).toBe('not-supported');
    expect(rejected.personalRecognition).toBe('rejected');
    const uncertain = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: recorded.id as string,
      evaluatorName: 'operator',
      evidenceSupport: 'uncertain',
      evaluatedAt: '2026-08-18T23:00:00.000Z',
    });
    expect(uncertain.status).toBe('recorded');
    expect(uncertain.id).not.toBe(rejected.id);
  });

  it('corrects without rewriting X', async () => {
    const x = await recordMachine('SYNTHETIC_MACHINE_X');
    const y = await derived.record({
      ...derivedInput(outputDir, 'SYNTHETIC_HUMAN_Y'),
      reviewState: 'recognized',
    });
    const result = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: x.id as string,
      evaluatorName: 'operator',
      evidenceSupport: 'not-supported',
      personalRecognition: 'rejected',
      suppliedRecordId: y.id as string,
      evaluatedAt: WHEN,
    });
    expect(result.status).toBe('recorded');
    expect(result.suppliedRecordId).toBe(y.id);
    const xFile = JSON.parse(
      readFileSync(join(outputDir, `${x.id}.json`), 'utf-8'),
    );
    expect(xFile.reviewState).toBe('unreviewed');
    expect(xFile.content).toBe('SYNTHETIC_MACHINE_X');
  });

  it('evaluates two competing interpretations differently', async () => {
    const a = await recordMachine('SYNTHETIC_MACHINE_A');
    const b = await recordMachine('SYNTHETIC_MACHINE_B');
    const accept = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: a.id as string,
      evaluatorName: 'operator',
      evidenceSupport: 'supported',
      evaluatedAt: WHEN,
    });
    const reject = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: b.id as string,
      evaluatorName: 'operator',
      evidenceSupport: 'not-supported',
      evaluatedAt: WHEN,
    });
    expect(accept.id).not.toBe(reject.id);
    expect(accept.evaluatedRecordId).toBe(a.id);
    expect(reject.evaluatedRecordId).toBe(b.id);
  });

  it('preserves two humans disagreeing about one interpretation', async () => {
    const recorded = await recordMachine('SYNTHETIC_MACHINE_X');
    const first = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: recorded.id as string,
      evaluatorName: 'human-1',
      personalRecognition: 'recognized',
      evaluatedAt: WHEN,
    });
    const second = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: recorded.id as string,
      evaluatorName: 'human-2',
      personalRecognition: 'rejected',
      evaluatedAt: WHEN,
    });
    expect(first.status).toBe('recorded');
    expect(second.status).toBe('recorded');
    expect(first.id).not.toBe(second.id);
  });

  it('keeps a later same-judgment act historical', async () => {
    const recorded = await recordMachine('SYNTHETIC_MACHINE_X');
    const first = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: recorded.id as string,
      evaluatorName: 'operator',
      evidenceSupport: 'supported',
      evaluatedAt: WHEN,
    });
    const later = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: recorded.id as string,
      evaluatorName: 'operator',
      evidenceSupport: 'supported',
      evaluatedAt: '2028-08-18T22:00:00.000Z',
    });
    expect(later.status).toBe('recorded');
    expect(later.id).not.toBe(first.id);
    const retry = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: recorded.id as string,
      evaluatorName: 'operator',
      evidenceSupport: 'supported',
      evaluatedAt: WHEN,
    });
    expect(retry.status).toBe('already-present');
    expect(retry.id).toBe(first.id);
  });

  it('does not write when the evaluated record is missing', async () => {
    const result = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: 'c'.repeat(64),
      evaluatorName: 'operator',
      evidenceSupport: 'supported',
      evaluatedAt: WHEN,
    });
    expect(result.status).toBe('not-found');
    expect(result.error).toBe('evaluated-record-missing');
    const store = new EvaluationStore();
    expect(await store.list(evaluationsDir)).toEqual([]);
  });

  it('does not write when the supplied record is missing', async () => {
    const x = await recordMachine('SYNTHETIC_MACHINE_X');
    const result = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: x.id as string,
      evaluatorName: 'operator',
      evidenceSupport: 'not-supported',
      suppliedRecordId: 'd'.repeat(64),
      evaluatedAt: WHEN,
    });
    expect(result.status).toBe('not-found');
    expect(result.error).toBe('supplied-record-missing');
    const store = new EvaluationStore();
    expect(await store.list(evaluationsDir)).toEqual([]);
  });

  it('does not write when a preceding evaluation is missing', async () => {
    const x = await recordMachine('SYNTHETIC_MACHINE_X');
    const result = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: x.id as string,
      evaluatorName: 'operator',
      evidenceSupport: 'supported',
      precedingEvaluationId: 'e'.repeat(64),
      evaluatedAt: WHEN,
    });
    expect(result.status).toBe('not-found');
    expect(result.error).toBe('preceding-evaluation-missing');
  });

  it('rejects both dimensions omitted and omits note from the result', async () => {
    const x = await recordMachine('SYNTHETIC_MACHINE_X');
    const missing = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: x.id as string,
      evaluatorName: 'operator',
      evaluatedAt: WHEN,
    });
    expect(missing.status).toBe('invalid');
    expect(missing.error).toContain('dimension-required');
    const withNote = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: x.id as string,
      evaluatorName: 'operator',
      evidenceSupport: 'supported',
      note: NOTE,
      evaluatedAt: WHEN,
    });
    expect(withNote.status).toBe('recorded');
    expect(JSON.stringify(withNote)).not.toContain(NOTE);
    const dumped = readFileSync(withNote.path as string, 'utf-8');
    expect(dumped).toContain(NOTE);
    expect(dumped).not.toMatch(/"source"\s*:\s*"chatgpt-export"/);
  });

  it('dry-run does not write', async () => {
    const x = await recordMachine('SYNTHETIC_MACHINE_X');
    const result = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: x.id as string,
      evaluatorName: 'operator',
      evidenceSupport: 'supported',
      evaluatedAt: WHEN,
      dryRun: true,
    });
    expect(result.status).toBe('dry-run');
    expect(existsSync(result.path as string)).toBe(false);
  });
});
