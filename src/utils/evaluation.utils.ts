import {
  DerivedEvaluation,
  EvaluateDerivedInput,
  EvaluationActor,
  EvidenceSupport,
  PersonalRecognition,
} from '../types';
import { sha256Hex } from './chatgpt-export.utils';
import { CONTENT_HASH } from './derived-record.utils';

export const DERIVED_EVALUATION_VERSION = 'derived-evaluation/1';

export const EVIDENCE_SUPPORT_VALUES = [
  'supported',
  'not-supported',
  'uncertain',
] as const satisfies readonly EvidenceSupport[];

export const PERSONAL_RECOGNITION_VALUES = [
  'recognized',
  'rejected',
  'uncertain',
] as const satisfies readonly PersonalRecognition[];

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/**
 * Immutable evaluation-act id. Timestamp participates: the same
 * judgment in 2026 and 2028 is two events. Persist time does not.
 */
export const evaluationId = (input: {
  evaluatedRecordId: string;
  evaluator: EvaluationActor;
  evaluatedAt: string;
  evidenceSupport?: EvidenceSupport;
  personalRecognition?: PersonalRecognition;
  noteRef?: string;
  suppliedRecordId?: string;
  precedingEvaluationId?: string;
}): string =>
  sha256Hex(
    JSON.stringify({
      schemaVersion: DERIVED_EVALUATION_VERSION,
      evaluatedRecordId: input.evaluatedRecordId,
      evaluator: {
        type: input.evaluator.type,
        name: input.evaluator.name,
      },
      evaluatedAt: input.evaluatedAt,
      ...(input.evidenceSupport
        ? { evidenceSupport: input.evidenceSupport }
        : {}),
      ...(input.personalRecognition
        ? { personalRecognition: input.personalRecognition }
        : {}),
      ...(input.noteRef ? { noteRef: input.noteRef } : {}),
      ...(input.suppliedRecordId
        ? { suppliedRecordId: input.suppliedRecordId }
        : {}),
      ...(input.precedingEvaluationId
        ? { precedingEvaluationId: input.precedingEvaluationId }
        : {}),
    }),
  );

/**
 * Recompute identity and, when both are present, the note hash.
 * A stored id that does not match these fields is corruption, not a
 * different review.
 */
export const evaluationIntegrityOk = (
  evaluation: DerivedEvaluation,
): boolean => {
  if (evaluation.evaluator.type !== 'human') return false;
  if (!evaluation.evaluator.name.trim()) return false;
  if (evaluation.note != null && evaluation.noteRef == null) return false;
  if (
    evaluation.note != null &&
    evaluation.noteRef != null &&
    sha256Hex(evaluation.note) !== evaluation.noteRef
  ) {
    return false;
  }
  return (
    evaluationId({
      evaluatedRecordId: evaluation.evaluatedRecordId,
      evaluator: {
        type: 'human',
        name: evaluation.evaluator.name,
      },
      evaluatedAt: evaluation.evaluatedAt,
      evidenceSupport: evaluation.evidenceSupport,
      personalRecognition: evaluation.personalRecognition,
      noteRef: evaluation.noteRef,
      suppliedRecordId: evaluation.suppliedRecordId,
      precedingEvaluationId: evaluation.precedingEvaluationId,
    }) === evaluation.id
  );
};

/** Shape + identity check. Null means unreadable as an evaluation. */
export const asDerivedEvaluation = (
  value: unknown,
): DerivedEvaluation | null => {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (rec.schemaVersion !== DERIVED_EVALUATION_VERSION) return null;
  if (typeof rec.id !== 'string') return null;
  if (typeof rec.evaluatedRecordId !== 'string') return null;
  if (typeof rec.evaluatedAt !== 'string') return null;
  if (typeof rec.recordedAt !== 'string') return null;
  if (!rec.evaluator || typeof rec.evaluator !== 'object') return null;
  const evaluator = rec.evaluator as Record<string, unknown>;
  if (typeof evaluator.type !== 'string' || typeof evaluator.name !== 'string') {
    return null;
  }
  const evaluation = value as DerivedEvaluation;
  return evaluationIntegrityOk(evaluation) ? evaluation : null;
};

/**
 * Structural problems that block recording. Empty means the draft is
 * valid enough to attempt store resolution.
 */
export const validateEvaluationDraft = (
  input: EvaluateDerivedInput,
): string[] => {
  const errors: string[] = [];
  if (!input.outputDir) {
    errors.push('derived-dir-required');
  }
  if (!input.evaluationsDir) {
    errors.push('evaluations-dir-required');
  }
  if (!CONTENT_HASH.test(input.evaluatedRecordId)) {
    errors.push('evaluated-record-id-invalid');
  }
  if (!input.evaluatorName.trim()) {
    errors.push('evaluator-name-missing');
  }
  if (!input.evidenceSupport && !input.personalRecognition) {
    errors.push('dimension-required');
  }
  if (
    input.evidenceSupport &&
    !EVIDENCE_SUPPORT_VALUES.includes(input.evidenceSupport)
  ) {
    errors.push(`unknown-evidence-support:${input.evidenceSupport}`);
  }
  if (
    input.personalRecognition &&
    !PERSONAL_RECOGNITION_VALUES.includes(input.personalRecognition)
  ) {
    errors.push(`unknown-personal-recognition:${input.personalRecognition}`);
  }
  if (input.evaluatedAt && !ISO_TIME.test(input.evaluatedAt)) {
    errors.push('evaluated-at-invalid');
  }
  if (input.recordedAt && !ISO_TIME.test(input.recordedAt)) {
    errors.push('recorded-at-invalid');
  }
  if (input.suppliedRecordId && !CONTENT_HASH.test(input.suppliedRecordId)) {
    errors.push('supplied-record-id-invalid');
  }
  if (
    input.precedingEvaluationId &&
    !CONTENT_HASH.test(input.precedingEvaluationId)
  ) {
    errors.push('preceding-evaluation-id-invalid');
  }
  if (
    input.suppliedRecordId &&
    input.suppliedRecordId === input.evaluatedRecordId
  ) {
    errors.push('supplied-record-same-as-evaluated');
  }
  return errors;
};

/**
 * Build an evaluation event. Pure: no I/O, no Activity, no mutation of
 * the evaluated DerivedRecord.
 */
export const buildDerivedEvaluation = (input: {
  evaluatedRecordId: string;
  evaluator: EvaluationActor;
  evaluatedAt: string;
  recordedAt: string;
  evidenceSupport?: EvidenceSupport;
  personalRecognition?: PersonalRecognition;
  note?: string;
  suppliedRecordId?: string;
  precedingEvaluationId?: string;
}): DerivedEvaluation => {
  const noteRef = input.note ? sha256Hex(input.note) : undefined;
  return {
    schemaVersion: DERIVED_EVALUATION_VERSION,
    id: evaluationId({
      evaluatedRecordId: input.evaluatedRecordId,
      evaluator: input.evaluator,
      evaluatedAt: input.evaluatedAt,
      evidenceSupport: input.evidenceSupport,
      personalRecognition: input.personalRecognition,
      noteRef,
      suppliedRecordId: input.suppliedRecordId,
      precedingEvaluationId: input.precedingEvaluationId,
    }),
    evaluatedRecordId: input.evaluatedRecordId,
    evaluator: input.evaluator,
    evaluatedAt: input.evaluatedAt,
    recordedAt: input.recordedAt,
    ...(input.evidenceSupport
      ? { evidenceSupport: input.evidenceSupport }
      : {}),
    ...(input.personalRecognition
      ? { personalRecognition: input.personalRecognition }
      : {}),
    ...(noteRef ? { noteRef, note: input.note } : {}),
    ...(input.suppliedRecordId
      ? { suppliedRecordId: input.suppliedRecordId }
      : {}),
    ...(input.precedingEvaluationId
      ? { precedingEvaluationId: input.precedingEvaluationId }
      : {}),
  };
};
