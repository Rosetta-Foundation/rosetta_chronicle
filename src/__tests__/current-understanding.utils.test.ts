import {
  classifyInterpretationKind,
  redactCurrentUnderstandingView,
} from '../utils/current-understanding.utils';
import { CurrentUnderstandingView, DerivedRecord } from '../types';

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
