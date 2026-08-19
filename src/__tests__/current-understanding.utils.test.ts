import {
  classifyInterpretationKind,
  projectCurrentUnderstanding,
  redactCurrentUnderstandingView,
} from '../utils/current-understanding.utils';
import { buildDerivedEvaluation } from '../utils/evaluation.utils';
import {
  CurrentUnderstandingPerspective,
  CurrentUnderstandingView,
  DerivedEvaluation,
  DerivedRecord,
} from '../types';

const HASH = 'd'.repeat(64);
const ID = 'a'.repeat(64);

const record = (overrides: Partial<DerivedRecord> = {}): DerivedRecord => ({
  id: ID,
  sourceRefs: [
    { sourceGraphHash: HASH, conversationId: 'conv-1', nodeIds: ['n1'] },
  ],
  transformationType: 'candidate-observation',
  transformationVersion: 'derived-record/1',
  createdAt: '2026-08-17T21:00:00.000Z',
  createdBy: { type: 'agent', name: 'fixture', model: 'fixture' },
  contentRef: 'e'.repeat(64),
  content: JSON.stringify({
    schemaVersion: 'candidate-observation/1',
    result: 'observation',
    statement: 'SYNTHETIC_STATEMENT',
    epistemicClass: 'directly-supported',
    citedNodeIds: ['n1'],
  }),
  reviewState: 'unreviewed',
  ...overrides,
});

describe('current-understanding utils', () => {
  it('keeps machine kind independent of reviewState', () => {
    expect(classifyInterpretationKind(record({ reviewState: 'recognized' }))).toBe(
      'machine-interpretation',
    );
  });

  it('classifies insufficient-evidence and human notes', () => {
    expect(
      classifyInterpretationKind(
        record({
          content: JSON.stringify({
            schemaVersion: 'candidate-observation/1',
            result: 'insufficient-evidence',
            citedNodeIds: ['n1'],
          }),
        }),
      ),
    ).toBe('insufficient-evidence');
    expect(
      classifyInterpretationKind(
        record({
          transformationType: 'human-note',
          content: 'SYNTHETIC_HUMAN_NOTE',
        }),
      ),
    ).toBe('human-interpretation');
  });

  it('redacts conversation and node ids from the CLI view', () => {
    const view: CurrentUnderstandingView = {
      status: 'ok',
      asOf: '2026-08-18T21:18:00.000Z',
      generatedAt: '2026-08-18T21:18:00.000Z',
      asOfSemantics: 'effective-event-time',
      perspective: { kind: 'evaluator', name: 'operator' },
      policy: { id: 'current-understanding', version: '1' },
      entries: [
        {
          derivedRecordId: ID,
          kind: 'machine-interpretation',
          currentEvidenceState: 'supported',
          currentRecognitionState: 'unassessed',
          contributingEvaluationIds: [],
          candidateSuccessorIds: [],
          explanation: {
            evaluatedRecordId: ID,
            evaluationIds: [],
            sourceRefs: [
              {
                sourceGraphHash: HASH,
                conversationId: 'conv-1',
                nodeIds: ['n1'],
              },
            ],
          },
        },
      ],
      unresolved: [],
      conflicts: [],
      failures: [],
    };
    const redacted = redactCurrentUnderstandingView(view);
    expect(redacted.entries[0]?.explanation.sourceRefs).toEqual([
      { sourceGraphHash: HASH },
    ]);
    expect(view.entries[0]?.explanation.sourceRefs[0]?.conversationId).toBe(
      'conv-1',
    );
  });
});

describe('current-understanding contributing ids', () => {
  const T1 = '2026-08-18T21:18:00.000Z';
  const T2 = '2026-08-19T21:18:00.000Z';
  const NOW = '2026-08-19T22:00:00.000Z';
  const note = (): DerivedRecord => ({
    id: ID,
    sourceRefs: [
      { sourceGraphHash: HASH, conversationId: 'conv-1', nodeIds: ['n1'] },
    ],
    transformationType: 'human-note',
    transformationVersion: 'derived-record/1',
    createdAt: '2026-08-17T21:00:00.000Z',
    createdBy: { type: 'human', name: 'fixture' },
    contentRef: 'e'.repeat(64),
    content: 'SYNTHETIC_HUMAN_NOTE',
    reviewState: 'unreviewed',
  });

  const ev = (input: Parameters<typeof buildDerivedEvaluation>[0]) =>
    buildDerivedEvaluation(input);

  const project = (
    evaluations: DerivedEvaluation[],
    perspective: CurrentUnderstandingPerspective,
  ) =>
    projectCurrentUnderstanding({
      records: [note()],
      evaluations,
      derivedInventory: {
        present: true,
        records: [note()],
        failures: [],
      },
      evaluationInventory: {
        present: true,
        records: evaluations,
        failures: [],
      },
      perspective,
      asOf: T2,
      generatedAt: NOW,
    });

  const E1Rec = ev({
    evaluatedRecordId: ID,
    evaluator: { type: 'human', name: 'operator' },
    evaluatedAt: T1,
    recordedAt: T1,
    personalRecognition: 'recognized',
  });
  const E2Rej = ev({
    evaluatedRecordId: ID,
    evaluator: { type: 'human', name: 'operator' },
    evaluatedAt: T2,
    recordedAt: T2,
    personalRecognition: 'rejected',
  });
  const E2Rec = ev({
    evaluatedRecordId: ID,
    evaluator: { type: 'human', name: 'operator' },
    evaluatedAt: T2,
    recordedAt: T2,
    personalRecognition: 'recognized',
  });
  const E2TieRec = ev({
    evaluatedRecordId: ID,
    evaluator: { type: 'human', name: 'operator' },
    evaluatedAt: T2,
    recordedAt: T2,
    personalRecognition: 'recognized',
    note: 'SYNTHETIC_TIE_RECOGNIZED',
  });
  const E2TieRej = ev({
    evaluatedRecordId: ID,
    evaluator: { type: 'human', name: 'operator' },
    evaluatedAt: T2,
    recordedAt: T2,
    personalRecognition: 'rejected',
    note: 'SYNTHETIC_TIE_REJECTED',
  });
  const E1Both = ev({
    evaluatedRecordId: ID,
    evaluator: { type: 'human', name: 'operator' },
    evaluatedAt: T1,
    recordedAt: T1,
    evidenceSupport: 'supported',
    personalRecognition: 'recognized',
  });
  const E2Ev = ev({
    evaluatedRecordId: ID,
    evaluator: { type: 'human', name: 'operator' },
    evaluatedAt: T2,
    recordedAt: T2,
    evidenceSupport: 'not-supported',
  });
  const Ea1 = ev({
    evaluatedRecordId: ID,
    evaluator: { type: 'human', name: 'alice' },
    evaluatedAt: T1,
    recordedAt: T1,
    personalRecognition: 'recognized',
  });
  const Ea2 = ev({
    evaluatedRecordId: ID,
    evaluator: { type: 'human', name: 'alice' },
    evaluatedAt: T2,
    recordedAt: T2,
    personalRecognition: 'rejected',
  });
  const Eb = ev({
    evaluatedRecordId: ID,
    evaluator: { type: 'human', name: 'bob' },
    evaluatedAt: T2,
    recordedAt: T2,
    personalRecognition: 'recognized',
  });

  it('cites only the later act after T1 recognized → T2 rejected', () => {
    const view = project([E1Rec, E2Rej], {
      kind: 'evaluator',
      name: 'operator',
    });
    expect(view.entries[0]?.currentRecognitionState).toBe('rejected');
    expect(view.entries[0]?.contributingEvaluationIds).toEqual([E2Rej.id]);
    expect(view.entries[0]?.explanation.evaluationIds).toEqual(
      [E1Rec.id, E2Rej.id].sort(),
    );
    expect(view.conflicts).toEqual([]);
  });

  it('cites only the later act when T2 repeats recognized', () => {
    const view = project([E1Rec, E2Rec], {
      kind: 'evaluator',
      name: 'operator',
    });
    expect(view.entries[0]?.currentRecognitionState).toBe('recognized');
    expect(view.entries[0]?.contributingEvaluationIds).toEqual([E2Rec.id]);
    expect(view.entries[0]?.explanation.evaluationIds).toEqual(
      [E1Rec.id, E2Rec.id].sort(),
    );
  });

  it('cites only the equal-time acts that produce a same-evaluator tie', () => {
    const view = project([E1Rec, E2TieRec, E2TieRej], {
      kind: 'evaluator',
      name: 'operator',
    });
    expect(view.entries[0]?.currentRecognitionState).toBe('conflict');
    expect(view.entries[0]?.contributingEvaluationIds).toEqual(
      [E2TieRec.id, E2TieRej.id].sort(),
    );
    expect(view.entries[0]?.explanation.evaluationIds).toEqual(
      [E1Rec.id, E2TieRec.id, E2TieRej.id].sort(),
    );
    expect(view.conflicts).toEqual([
      expect.objectContaining({
        code: 'same-evaluator-tie',
        dimension: 'personalRecognition',
        evaluationIds: [E2TieRec.id, E2TieRej.id].sort(),
      }),
    ]);
  });

  it('keeps a T1 recognition contributor when only evidence is revised at T2', () => {
    const view = project([E1Both, E2Ev], {
      kind: 'evaluator',
      name: 'operator',
    });
    expect(view.entries[0]?.currentEvidenceState).toBe('not-supported');
    expect(view.entries[0]?.currentRecognitionState).toBe('recognized');
    expect(view.entries[0]?.contributingEvaluationIds).toEqual(
      [E1Both.id, E2Ev.id].sort(),
    );
    expect(view.entries[0]?.explanation.evaluationIds).toEqual(
      [E1Both.id, E2Ev.id].sort(),
    );
  });

  it('does not cite Alice’s superseded act in a later disagreement with Bob', () => {
    const view = project([Ea1, Ea2, Eb], { kind: 'all' });
    expect(view.entries[0]?.currentRecognitionState).toBe('conflict');
    expect(view.entries[0]?.contributingEvaluationIds).toEqual(
      [Ea2.id, Eb.id].sort(),
    );
    expect(view.entries[0]?.perspectiveStates).toEqual([
      expect.objectContaining({
        evaluator: { type: 'human', name: 'alice' },
        recognitionState: 'rejected',
        contributingEvaluationIds: [Ea2.id],
      }),
      expect.objectContaining({
        evaluator: { type: 'human', name: 'bob' },
        recognitionState: 'recognized',
        contributingEvaluationIds: [Eb.id],
      }),
    ]);
    expect(view.entries[0]?.explanation.evaluationIds).toEqual(
      [Ea1.id, Ea2.id, Eb.id].sort(),
    );
    expect(view.conflicts).toEqual([
      expect.objectContaining({
        code: 'cross-evaluator-disagreement',
        dimension: 'personalRecognition',
        evaluationIds: [Ea2.id, Eb.id].sort(),
      }),
    ]);
  });
});
