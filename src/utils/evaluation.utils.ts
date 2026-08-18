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

/** Closed `derived-evaluation/1` surface. Extra keys are not schema-valid. */
export const DERIVED_EVALUATION_KEYS = [
  'schemaVersion',
  'id',
  'evaluatedRecordId',
  'evaluator',
  'evaluatedAt',
  'recordedAt',
  'evidenceSupport',
  'personalRecognition',
  'noteRef',
  'note',
  'suppliedRecordId',
  'precedingEvaluationId',
] as const;

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export const isEvaluationTime = (value: unknown): value is string =>
  typeof value === 'string' && ISO_TIME.test(value);

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
 * Runtime schema for a persisted evaluation. Identity is a second
 * check — a self-consistent illegal enum is still invalid.
 */
export const evaluationSchemaOk = (
  rec: Record<string, unknown>,
): rec is Record<string, unknown> & DerivedEvaluation => {
  const allowed = new Set<string>(DERIVED_EVALUATION_KEYS);
  if (Object.keys(rec).some((key) => !allowed.has(key))) return false;
  if (rec.schemaVersion !== DERIVED_EVALUATION_VERSION) return false;
  if (typeof rec.id !== 'string' || !CONTENT_HASH.test(rec.id)) return false;
  if (
    typeof rec.evaluatedRecordId !== 'string' ||
    !CONTENT_HASH.test(rec.evaluatedRecordId)
  ) {
    return false;
  }
  if (!isEvaluationTime(rec.evaluatedAt)) return false;
  if (!isEvaluationTime(rec.recordedAt)) return false;
  if (!rec.evaluator || typeof rec.evaluator !== 'object') return false;
  const evaluator = rec.evaluator as Record<string, unknown>;
  if (evaluator.type !== 'human') return false;
  if (typeof evaluator.name !== 'string' || !evaluator.name.trim()) {
    return false;
  }
  const keys = Object.keys(evaluator).sort();
  if (keys.length !== 2 || keys[0] !== 'name' || keys[1] !== 'type') {
    return false;
  }
  const hasEvidence = rec.evidenceSupport !== undefined;
  const hasRecognition = rec.personalRecognition !== undefined;
  if (!hasEvidence && !hasRecognition) return false;
  if (
    hasEvidence &&
    (typeof rec.evidenceSupport !== 'string' ||
      !EVIDENCE_SUPPORT_VALUES.includes(
        rec.evidenceSupport as EvidenceSupport,
      ))
  ) {
    return false;
  }
  if (
    hasRecognition &&
    (typeof rec.personalRecognition !== 'string' ||
      !PERSONAL_RECOGNITION_VALUES.includes(
        rec.personalRecognition as PersonalRecognition,
      ))
  ) {
    return false;
  }
  if (rec.suppliedRecordId !== undefined) {
    if (
      typeof rec.suppliedRecordId !== 'string' ||
      !CONTENT_HASH.test(rec.suppliedRecordId) ||
      rec.suppliedRecordId === rec.evaluatedRecordId
    ) {
      return false;
    }
  }
  if (rec.precedingEvaluationId !== undefined) {
    if (
      typeof rec.precedingEvaluationId !== 'string' ||
      !CONTENT_HASH.test(rec.precedingEvaluationId)
    ) {
      return false;
    }
  }
  if (rec.noteRef !== undefined) {
    if (typeof rec.noteRef !== 'string' || !CONTENT_HASH.test(rec.noteRef)) {
      return false;
    }
  }
  if (rec.note !== undefined) {
    if (typeof rec.note !== 'string') return false;
    if (typeof rec.noteRef !== 'string') return false;
    if (sha256Hex(rec.note) !== rec.noteRef) return false;
  }
  return true;
};

/**
 * Recompute identity from schema-valid fields. A stored id that does
 * not match is corruption, not a different review.
 */
export const evaluationIntegrityOk = (
  evaluation: DerivedEvaluation,
): boolean =>
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
  }) === evaluation.id;

/**
 * Schema validity and content-addressed identity. Null means the
 * artifact is not a resolvable evaluation.
 */
export const asDerivedEvaluation = (
  value: unknown,
): DerivedEvaluation | null => {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (!evaluationSchemaOk(rec)) return null;
  const evaluation: DerivedEvaluation = {
    schemaVersion: DERIVED_EVALUATION_VERSION,
    id: rec.id as string,
    evaluatedRecordId: rec.evaluatedRecordId as string,
    evaluator: {
      type: 'human',
      name: (rec.evaluator as { name: string }).name,
    },
    evaluatedAt: rec.evaluatedAt as string,
    recordedAt: rec.recordedAt as string,
    ...(rec.evidenceSupport
      ? { evidenceSupport: rec.evidenceSupport as EvidenceSupport }
      : {}),
    ...(rec.personalRecognition
      ? { personalRecognition: rec.personalRecognition as PersonalRecognition }
      : {}),
    ...(typeof rec.noteRef === 'string' ? { noteRef: rec.noteRef } : {}),
    ...(typeof rec.note === 'string' ? { note: rec.note } : {}),
    ...(typeof rec.suppliedRecordId === 'string'
      ? { suppliedRecordId: rec.suppliedRecordId }
      : {}),
    ...(typeof rec.precedingEvaluationId === 'string'
      ? { precedingEvaluationId: rec.precedingEvaluationId }
      : {}),
  };
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
  if (input.evaluatedAt && !isEvaluationTime(input.evaluatedAt)) {
    errors.push('evaluated-at-invalid');
  }
  if (input.recordedAt && !isEvaluationTime(input.recordedAt)) {
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
