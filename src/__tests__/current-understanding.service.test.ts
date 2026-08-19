import 'reflect-metadata';
import { Container } from 'inversify';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  CurrentUnderstandingInput,
  CurrentUnderstandingView,
  DerivedRecord,
} from '../types';
import { buildDerivedEvaluation } from '../utils/evaluation.utils';

const { CHRONICLE_TOKENS } = require('../tokens');
const {
  CurrentUnderstandingService,
} = require('../services/current-understanding.service');
const {
  DerivedRecordStore,
} = require('../repositories/derived-record-store.repository');
const {
  EvaluationStore,
} = require('../repositories/evaluation-store.repository');

const HASH = 'd'.repeat(64);
const DER_A = 'a'.repeat(64);
const DER_B = 'b'.repeat(64);
const DER_C = 'c'.repeat(64);
const DER_Y = '1'.repeat(64);
const CREATED = '2026-08-17T21:00:00.000Z';
const T1 = '2026-08-18T21:18:00.000Z';
const T2 = '2026-08-19T21:18:00.000Z';
const T3 = '2028-01-01T00:00:00.000Z';
const RECORDED_LATE = '2029-01-01T00:00:00.000Z';

const observation = (statement: string): string =>
  JSON.stringify({
    schemaVersion: 'candidate-observation/1',
    result: 'observation',
    statement,
    epistemicClass: 'directly-supported',
    citedNodeIds: ['n1'],
  });

const insufficient = (): string =>
  JSON.stringify({
    schemaVersion: 'candidate-observation/1',
    result: 'insufficient-evidence',
    citedNodeIds: ['n1'],
  });

const machine = (
  id: string,
  content: string,
  reviewState: DerivedRecord['reviewState'] = 'unreviewed',
): DerivedRecord => ({
  id,
  sourceRefs: [
    { sourceGraphHash: HASH, conversationId: 'conv-1', nodeIds: ['n1'] },
  ],
  transformationType: 'candidate-observation',
  transformationVersion: 'derived-record/1',
  createdAt: CREATED,
  createdBy: { type: 'agent', name: 'chronicle-interpret', model: 'fixture' },
  contentRef: 'e'.repeat(64),
  content,
  reviewState,
  executionId: 'f'.repeat(64),
});

const humanNote = (id: string): DerivedRecord => ({
  id,
  sourceRefs: [
    { sourceGraphHash: HASH, conversationId: 'conv-1', nodeIds: ['n1'] },
  ],
  transformationType: 'human-note',
  transformationVersion: 'derived-record/1',
  createdAt: CREATED,
  createdBy: { type: 'human', name: 'fixture' },
  contentRef: 'e'.repeat(64),
  content: 'SYNTHETIC_HUMAN_NOTE',
  reviewState: 'recognized',
});

describe('CurrentUnderstandingService', () => {
  let outputDir: string;
  let evaluationsDir: string;
  let derivedStore: {
    write: (dir: string, record: DerivedRecord) => Promise<string>;
  };
  let evaluationStore: {
    write: (dir: string, record: unknown) => Promise<string>;
  };
  let service: {
    project: (
      input: CurrentUnderstandingInput,
    ) => Promise<CurrentUnderstandingView>;
  };

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'cu-derived-'));
    evaluationsDir = mkdtempSync(join(tmpdir(), 'cu-eval-'));
    const container = new Container();
    container.bind(CHRONICLE_TOKENS.DerivedRecordStore).to(DerivedRecordStore);
    container.bind(CHRONICLE_TOKENS.EvaluationStore).to(EvaluationStore);
    container
      .bind(CHRONICLE_TOKENS.CurrentUnderstandingService)
      .to(CurrentUnderstandingService);
    derivedStore = container.get(CHRONICLE_TOKENS.DerivedRecordStore);
    evaluationStore = container.get(CHRONICLE_TOKENS.EvaluationStore);
    service = container.get(CHRONICLE_TOKENS.CurrentUnderstandingService);
  });
  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
    rmSync(evaluationsDir, { recursive: true, force: true });
  });

  const project = (input: Partial<CurrentUnderstandingInput> = {}) =>
    service.project({
      outputDir,
      evaluationsDir,
      evaluatorName: 'operator',
      asOf: T2,
      generatedAt: T2,
      ...input,
    });

  it('projects an unevaluated machine interpretation as unassessed', async () => {
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A')),
    );
    const view = await project();
    expect(view.status).toBe('ok');
    expect(view.asOfSemantics).toBe('effective-event-time');
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]).toMatchObject({
      derivedRecordId: DER_A,
      kind: 'machine-interpretation',
      currentEvidenceState: 'unassessed',
      currentRecognitionState: 'unassessed',
    });
    expect(view.unresolved.map((row) => row.code).sort()).toEqual([
      'evidence-unassessed',
      'recognition-unassessed',
    ]);
  });

  it('reduces evidence support only', async () => {
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A')),
    );
    await evaluationStore.write(
      evaluationsDir,
      buildDerivedEvaluation({
        evaluatedRecordId: DER_A,
        evaluator: { type: 'human', name: 'operator' },
        evaluatedAt: T1,
        recordedAt: T1,
        evidenceSupport: 'supported',
      }),
    );
    const view = await project();
    expect(view.entries[0]?.currentEvidenceState).toBe('supported');
    expect(view.entries[0]?.currentRecognitionState).toBe('unassessed');
    expect(view.entries[0]?.kind).toBe('machine-interpretation');
  });

  it('reduces personal recognition only', async () => {
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A')),
    );
    await evaluationStore.write(
      evaluationsDir,
      buildDerivedEvaluation({
        evaluatedRecordId: DER_A,
        evaluator: { type: 'human', name: 'operator' },
        evaluatedAt: T1,
        recordedAt: T1,
        personalRecognition: 'recognized',
      }),
    );
    const view = await project();
    expect(view.entries[0]?.currentEvidenceState).toBe('unassessed');
    expect(view.entries[0]?.currentRecognitionState).toBe('recognized');
  });

  it('reduces both dimensions independently', async () => {
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A')),
    );
    await evaluationStore.write(
      evaluationsDir,
      buildDerivedEvaluation({
        evaluatedRecordId: DER_A,
        evaluator: { type: 'human', name: 'operator' },
        evaluatedAt: T1,
        recordedAt: T1,
        evidenceSupport: 'supported',
        personalRecognition: 'rejected',
      }),
    );
    const view = await project();
    expect(view.entries[0]?.currentEvidenceState).toBe('supported');
    expect(view.entries[0]?.currentRecognitionState).toBe('rejected');
  });

  it('lets a later same-evaluator act change current state', async () => {
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A')),
    );
    await evaluationStore.write(
      evaluationsDir,
      buildDerivedEvaluation({
        evaluatedRecordId: DER_A,
        evaluator: { type: 'human', name: 'operator' },
        evaluatedAt: T1,
        recordedAt: T1,
        personalRecognition: 'recognized',
      }),
    );
    await evaluationStore.write(
      evaluationsDir,
      buildDerivedEvaluation({
        evaluatedRecordId: DER_A,
        evaluator: { type: 'human', name: 'operator' },
        evaluatedAt: T2,
        recordedAt: T2,
        personalRecognition: 'rejected',
      }),
    );
    const now = await project({ asOf: T2 });
    expect(now.entries[0]?.currentRecognitionState).toBe('rejected');
    const earlier = await project({ asOf: T1 });
    expect(earlier.entries[0]?.currentRecognitionState).toBe('recognized');
  });

  it('includes a reconstructed older evaluatedAt even when recorded later', async () => {
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A')),
    );
    await evaluationStore.write(
      evaluationsDir,
      buildDerivedEvaluation({
        evaluatedRecordId: DER_A,
        evaluator: { type: 'human', name: 'operator' },
        evaluatedAt: T1,
        recordedAt: RECORDED_LATE,
        personalRecognition: 'recognized',
      }),
    );
    const view = await project({ asOf: T1 });
    expect(view.entries[0]?.currentRecognitionState).toBe('recognized');
  });

  it('keeps per-evaluator states under perspective all', async () => {
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A')),
    );
    await evaluationStore.write(
      evaluationsDir,
      buildDerivedEvaluation({
        evaluatedRecordId: DER_A,
        evaluator: { type: 'human', name: 'alice' },
        evaluatedAt: T1,
        recordedAt: T1,
        personalRecognition: 'recognized',
      }),
    );
    await evaluationStore.write(
      evaluationsDir,
      buildDerivedEvaluation({
        evaluatedRecordId: DER_A,
        evaluator: { type: 'human', name: 'bob' },
        evaluatedAt: T1,
        recordedAt: T1,
        personalRecognition: 'rejected',
      }),
    );
    const named = await project({ evaluatorName: 'alice' });
    expect(named.entries[0]?.currentRecognitionState).toBe('recognized');
    expect(named.conflicts).toEqual([]);
    const all = await project({
      evaluatorName: undefined,
      perspectiveAll: true,
    });
    expect(all.entries[0]?.currentRecognitionState).toBe('conflict');
    expect(all.entries[0]?.perspectiveStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evaluator: { type: 'human', name: 'alice' },
          recognitionState: 'recognized',
        }),
        expect.objectContaining({
          evaluator: { type: 'human', name: 'bob' },
          recognitionState: 'rejected',
        }),
      ]),
    );
    expect(all.conflicts.map((row) => row.code)).toContain(
      'cross-evaluator-disagreement',
    );
    expect(all.entries[0]?.perspectiveStates?.map((row) => row.evaluator.name)).toEqual(
      ['alice', 'bob'],
    );
  });

  it('does not infer competition from shared source refs', async () => {
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A')),
    );
    await derivedStore.write(
      outputDir,
      machine(DER_B, observation('SYNTHETIC_STATEMENT_B')),
    );
    for (const id of [DER_A, DER_B]) {
      await evaluationStore.write(
        evaluationsDir,
        buildDerivedEvaluation({
          evaluatedRecordId: id,
          evaluator: { type: 'human', name: 'operator' },
          evaluatedAt: T1,
          recordedAt: T1,
          personalRecognition: 'recognized',
        }),
      );
    }
    const view = await project();
    expect(view.entries).toHaveLength(2);
    expect(view.conflicts.map((row) => row.code)).not.toContain(
      'co-recognized-competitors',
    );
  });

  it('does not promote a correction successor', async () => {
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A')),
    );
    await derivedStore.write(outputDir, humanNote(DER_Y));
    await evaluationStore.write(
      evaluationsDir,
      buildDerivedEvaluation({
        evaluatedRecordId: DER_A,
        evaluator: { type: 'human', name: 'operator' },
        evaluatedAt: T1,
        recordedAt: T1,
        evidenceSupport: 'supported',
        personalRecognition: 'rejected',
        suppliedRecordId: DER_Y,
      }),
    );
    const view = await project();
    const original = view.entries.find((row) => row.derivedRecordId === DER_A);
    const successor = view.entries.find((row) => row.derivedRecordId === DER_Y);
    expect(original?.currentEvidenceState).toBe('supported');
    expect(original?.currentRecognitionState).toBe('rejected');
    expect(original?.candidateSuccessorIds).toEqual([DER_Y]);
    expect(successor?.kind).toBe('human-interpretation');
    expect(successor?.currentRecognitionState).toBe('unassessed');
    expect(successor?.currentEvidenceState).toBe('unassessed');
  });

  it('surfaces a successor fork', async () => {
    const other = '2'.repeat(64);
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A')),
    );
    await derivedStore.write(outputDir, humanNote(DER_Y));
    await derivedStore.write(outputDir, humanNote(other));
    await evaluationStore.write(
      evaluationsDir,
      buildDerivedEvaluation({
        evaluatedRecordId: DER_A,
        evaluator: { type: 'human', name: 'operator' },
        evaluatedAt: T1,
        recordedAt: T1,
        evidenceSupport: 'supported',
        suppliedRecordId: DER_Y,
      }),
    );
    await evaluationStore.write(
      evaluationsDir,
      buildDerivedEvaluation({
        evaluatedRecordId: DER_A,
        evaluator: { type: 'human', name: 'operator' },
        evaluatedAt: T2,
        recordedAt: T2,
        evidenceSupport: 'supported',
        suppliedRecordId: other,
      }),
    );
    const view = await project();
    expect(view.conflicts.map((row) => row.code)).toContain('successor-fork');
  });

  it('surfaces a same-evaluator timestamp tie', async () => {
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A')),
    );
    await evaluationStore.write(
      evaluationsDir,
      buildDerivedEvaluation({
        evaluatedRecordId: DER_A,
        evaluator: { type: 'human', name: 'operator' },
        evaluatedAt: T1,
        recordedAt: T1,
        evidenceSupport: 'supported',
      }),
    );
    await evaluationStore.write(
      evaluationsDir,
      buildDerivedEvaluation({
        evaluatedRecordId: DER_A,
        evaluator: { type: 'human', name: 'operator' },
        evaluatedAt: T1,
        recordedAt: T1,
        evidenceSupport: 'not-supported',
        note: 'SYNTHETIC_TIE_NOTE',
      }),
    );
    const view = await project();
    expect(view.entries[0]?.currentEvidenceState).toBe('conflict');
    expect(view.conflicts.map((row) => row.code)).toContain(
      'same-evaluator-tie',
    );
  });

  it('keeps machine kind after later recognition', async () => {
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A'), 'recognized'),
    );
    await evaluationStore.write(
      evaluationsDir,
      buildDerivedEvaluation({
        evaluatedRecordId: DER_A,
        evaluator: { type: 'human', name: 'operator' },
        evaluatedAt: T1,
        recordedAt: T1,
        personalRecognition: 'recognized',
      }),
    );
    const view = await project();
    expect(view.entries[0]?.kind).toBe('machine-interpretation');
    expect(view.entries[0]?.currentRecognitionState).toBe('recognized');
  });

  it('ignores reviewState on a human note', async () => {
    await derivedStore.write(outputDir, humanNote(DER_Y));
    const view = await project();
    expect(view.entries[0]?.kind).toBe('human-interpretation');
    expect(view.entries[0]?.currentRecognitionState).toBe('unassessed');
  });

  it('classifies insufficient-evidence without treating it as a fact', async () => {
    await derivedStore.write(outputDir, machine(DER_C, insufficient()));
    const view = await project();
    expect(view.entries[0]?.kind).toBe('insufficient-evidence');
    expect(view.entries[0]?.currentEvidenceState).toBe('unassessed');
  });

  it('reports partial when an unreferenced evaluation file is corrupt', async () => {
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A')),
    );
    writeFileSync(join(evaluationsDir, `${'9'.repeat(64)}.json`), '{');
    const view = await project();
    expect(view.status).toBe('partial');
    expect(view.failures.map((row) => row.code)).toContain(
      'evaluation-invalid',
    );
  });

  it('reports partial when an unreferenced derived file is corrupt', async () => {
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A')),
    );
    writeFileSync(join(outputDir, `${'8'.repeat(64)}.json`), '{');
    const view = await project();
    expect(view.status).toBe('partial');
    expect(view.failures.map((row) => row.code)).toContain('derived-invalid');
  });

  it('orders entries deterministically', async () => {
    await derivedStore.write(
      outputDir,
      machine(DER_B, observation('SYNTHETIC_STATEMENT_B')),
    );
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A')),
    );
    const first = await project();
    const second = await project();
    expect(first.entries.map((row) => row.derivedRecordId)).toEqual([
      DER_A,
      DER_B,
    ]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('keeps exact source refs on the service model', async () => {
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A')),
    );
    const view = await project();
    expect(view.entries[0]?.explanation.sourceRefs).toEqual([
      { sourceGraphHash: HASH, conversationId: 'conv-1', nodeIds: ['n1'] },
    ]);
  });

  it('writes nothing', async () => {
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A')),
    );
    const beforeDerived = readdirSync(outputDir);
    const beforeEval = readdirSync(evaluationsDir);
    await project();
    expect(readdirSync(outputDir)).toEqual(beforeDerived);
    expect(readdirSync(evaluationsDir)).toEqual(beforeEval);
  });

  it('returns not-found when a required directory is missing', async () => {
    const view = await service.project({
      outputDir: join(outputDir, 'missing'),
      evaluationsDir,
      evaluatorName: 'operator',
      asOf: T2,
      generatedAt: T2,
    });
    expect(view.status).toBe('not-found');
  });

  it('returns invalid without a perspective', async () => {
    const view = await project({
      evaluatorName: undefined,
      perspectiveAll: undefined,
    });
    expect(view.status).toBe('invalid');
  });

  it('does not read as-of T3 when only T1 exists as current for T1', async () => {
    await derivedStore.write(
      outputDir,
      machine(DER_A, observation('SYNTHETIC_STATEMENT_A')),
    );
    await evaluationStore.write(
      evaluationsDir,
      buildDerivedEvaluation({
        evaluatedRecordId: DER_A,
        evaluator: { type: 'human', name: 'operator' },
        evaluatedAt: T3,
        recordedAt: T3,
        personalRecognition: 'rejected',
      }),
    );
    const view = await project({ asOf: T1 });
    expect(view.entries[0]?.currentRecognitionState).toBe('unassessed');
  });
});
