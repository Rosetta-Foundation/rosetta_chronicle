import {
  asDerivedEvaluation,
  buildDerivedEvaluation,
  evaluationId,
  evaluationIntegrityOk,
  validateEvaluationDraft,
} from '../utils/evaluation.utils';

const HASH = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const WHEN = '2026-08-18T22:00:00.000Z';

const draft = () => ({
  outputDir: '/derived',
  evaluationsDir: '/evaluations',
  evaluatedRecordId: HASH,
  evaluatorName: 'operator',
  evidenceSupport: 'supported' as const,
  evaluatedAt: WHEN,
});

describe('evaluation.utils', () => {
  it('requires a dimension and a derived store', () => {
    expect(
      validateEvaluationDraft({
        outputDir: '/derived',
        evaluationsDir: '/evaluations',
        evaluatedRecordId: HASH,
        evaluatorName: 'operator',
      }),
    ).toContain('dimension-required');
    expect(
      validateEvaluationDraft({
        ...draft(),
        outputDir: '',
      }),
    ).toContain('derived-dir-required');
  });

  it('rejects an agent-shaped id and a bad timestamp', () => {
    expect(
      validateEvaluationDraft({
        ...draft(),
        evaluatedRecordId: 'nope',
      }),
    ).toContain('evaluated-record-id-invalid');
    expect(
      validateEvaluationDraft({
        ...draft(),
        evaluatedAt: 'yesterday',
      }),
    ).toContain('evaluated-at-invalid');
  });

  it('keeps 2026 and 2028 as distinct acts', () => {
    const shared = {
      evaluatedRecordId: HASH,
      evaluator: { type: 'human' as const, name: 'operator' },
      evidenceSupport: 'supported' as const,
    };
    const a = evaluationId({ ...shared, evaluatedAt: WHEN });
    const b = evaluationId({
      ...shared,
      evaluatedAt: '2028-08-18T22:00:00.000Z',
    });
    expect(a).not.toBe(b);
  });

  it('does not collapse evaluations of two derived records', () => {
    const shared = {
      evaluator: { type: 'human' as const, name: 'operator' },
      evaluatedAt: WHEN,
      evidenceSupport: 'supported' as const,
    };
    expect(
      evaluationId({ ...shared, evaluatedRecordId: HASH }),
    ).not.toBe(evaluationId({ ...shared, evaluatedRecordId: HASH_B }));
  });

  it('does not put recordedAt into identity', () => {
    const first = buildDerivedEvaluation({
      evaluatedRecordId: HASH,
      evaluator: { type: 'human', name: 'operator' },
      evaluatedAt: WHEN,
      recordedAt: WHEN,
      evidenceSupport: 'supported',
    });
    const second = buildDerivedEvaluation({
      evaluatedRecordId: HASH,
      evaluator: { type: 'human', name: 'operator' },
      evaluatedAt: WHEN,
      recordedAt: '2026-08-19T00:00:00.000Z',
      evidenceSupport: 'supported',
    });
    expect(first.id).toBe(second.id);
    expect(first.recordedAt).not.toBe(second.recordedAt);
  });

  it('rejects a stored identity that no longer hashes to its id', () => {
    const record = buildDerivedEvaluation({
      evaluatedRecordId: HASH,
      evaluator: { type: 'human', name: 'operator' },
      evaluatedAt: WHEN,
      recordedAt: WHEN,
      evidenceSupport: 'supported',
    });
    expect(evaluationIntegrityOk(record)).toBe(true);
    expect(
      evaluationIntegrityOk({ ...record, evidenceSupport: 'uncertain' }),
    ).toBe(false);
    expect(
      asDerivedEvaluation({ ...record, evidenceSupport: 'uncertain' }),
    ).toBeNull();
  });
});
