import {
  CurrentUnderstandingEntry,
  CurrentUnderstandingFailure,
  CurrentUnderstandingFlag,
  CurrentUnderstandingInput,
  CurrentUnderstandingPerspective,
  CurrentUnderstandingView,
  DerivedEvaluation,
  DerivedRecord,
  EvidenceState,
  EvidenceSupport,
  InterpretationKind,
  PersonalRecognition,
  RecognitionState,
  StoreInventory,
} from '../types';
import { isEvaluationTime } from './evaluation.utils';

export const CURRENT_UNDERSTANDING_POLICY = {
  id: 'current-understanding',
  version: '1',
} as const;

export const AS_OF_SEMANTICS = 'effective-event-time' as const;

type Dimension = 'evidenceSupport' | 'personalRecognition';

interface DimensionReduction {
  state: EvidenceState | RecognitionState;
  contributingIds: string[];
  tie: boolean;
}

/**
 * Historical kind. Does not change when a later human recognizes the
 * record. `reviewState` is ignored.
 */
export const classifyInterpretationKind = (
  record: DerivedRecord,
): InterpretationKind => {
  if (record.transformationType !== 'candidate-observation') {
    return 'human-interpretation';
  }
  if (typeof record.content !== 'string') return 'unclassified';
  try {
    const parsed: unknown = JSON.parse(record.content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'unclassified';
    }
    const result = (parsed as { result?: unknown }).result;
    if (result === 'insufficient-evidence') return 'insufficient-evidence';
    if (result === 'observation') return 'machine-interpretation';
    return 'unclassified';
  } catch {
    return 'unclassified';
  }
};

/**
 * Default CLI renderer: keep hashes and enums, drop conversation and
 * node identifiers. The service view still holds exact sourceRefs.
 */
export const redactCurrentUnderstandingView = (
  view: CurrentUnderstandingView,
): CurrentUnderstandingView => ({
  ...view,
  entries: view.entries.map((entry) => ({
    ...entry,
    explanation: {
      ...entry.explanation,
      sourceRefs: entry.explanation.sourceRefs.map((ref) => ({
        sourceGraphHash: ref.sourceGraphHash,
      })),
    },
  })),
});

export const parseCurrentUnderstandingPerspective = (
  input: CurrentUnderstandingInput,
):
  | { perspective: CurrentUnderstandingPerspective }
  | { error: string } => {
  const named = Boolean(input.evaluatorName);
  const all = Boolean(input.perspectiveAll);
  if (named === all) {
    return { error: 'perspective-required' };
  }
  if (all) return { perspective: { kind: 'all' } };
  const name = input.evaluatorName?.trim() ?? '';
  if (!name) return { error: 'evaluator-name-missing' };
  return { perspective: { kind: 'evaluator', name } };
};

const uniqueSorted = (values: string[]): string[] =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b));

const compareFlag = (
  a: CurrentUnderstandingFlag,
  b: CurrentUnderstandingFlag,
): number =>
  a.code.localeCompare(b.code) ||
  (a.derivedRecordIds[0] ?? '').localeCompare(b.derivedRecordIds[0] ?? '') ||
  (a.dimension ?? '').localeCompare(b.dimension ?? '');

const compareFailure = (
  a: CurrentUnderstandingFailure,
  b: CurrentUnderstandingFailure,
): number =>
  a.code.localeCompare(b.code) ||
  (a.ref?.kind ?? '').localeCompare(b.ref?.kind ?? '') ||
  (a.ref?.id ?? '').localeCompare(b.ref?.id ?? '');

const reduceDimension = (
  evaluations: DerivedEvaluation[],
  evaluatorName: string,
  derivedId: string,
  dimension: Dimension,
  asOf: string,
): DimensionReduction => {
  const relevant = evaluations
    .filter((row) => row.evaluator.name === evaluatorName)
    .filter((row) => row.evaluatedRecordId === derivedId)
    .filter((row) => row.evaluatedAt <= asOf)
    .filter((row) => row[dimension] != null)
    .sort(
      (a, b) =>
        a.evaluatedAt.localeCompare(b.evaluatedAt) || a.id.localeCompare(b.id),
    );
  if (relevant.length === 0) {
    return { state: 'unassessed', contributingIds: [], tie: false };
  }
  const latestAt = relevant[relevant.length - 1]?.evaluatedAt ?? '';
  const latest = relevant.filter((row) => row.evaluatedAt === latestAt);
  const values = uniqueSorted(
    latest
      .map((row) => row[dimension])
      .filter((value): value is EvidenceSupport | PersonalRecognition =>
        Boolean(value),
      ),
  );
  const contributingIds = uniqueSorted(relevant.map((row) => row.id));
  if (values.length > 1) {
    return { state: 'conflict', contributingIds, tie: true };
  }
  return {
    state: (values[0] ?? 'unassessed') as EvidenceState | RecognitionState,
    contributingIds,
    tie: false,
  };
};

const aggregateDimension = (
  states: Array<EvidenceState | RecognitionState>,
): EvidenceState | RecognitionState => {
  const assessed = states.filter((state) => state !== 'unassessed');
  if (assessed.length === 0) return 'unassessed';
  if (assessed.some((state) => state === 'conflict')) return 'conflict';
  const distinct = uniqueSorted(assessed);
  return distinct.length === 1
    ? (distinct[0] as EvidenceState | RecognitionState)
    : 'conflict';
};

const observedEvaluatorNames = (
  evaluations: DerivedEvaluation[],
  asOf: string,
): string[] =>
  uniqueSorted(
    evaluations
      .filter((row) => row.evaluatedAt <= asOf)
      .map((row) => row.evaluator.name),
  );

/**
 * Deterministic projection. Does not write, invoke a model, or infer
 * competition from shared source refs.
 */
export const projectCurrentUnderstanding = (input: {
  records: DerivedRecord[];
  evaluations: DerivedEvaluation[];
  derivedInventory: StoreInventory<DerivedRecord>;
  evaluationInventory: StoreInventory<DerivedEvaluation>;
  perspective: CurrentUnderstandingPerspective;
  asOf: string;
  generatedAt: string;
}): CurrentUnderstandingView => {
  const { records, evaluations, perspective, asOf, generatedAt } = input;
  const recordIds = new Set(records.map((row) => row.id));
  const failures: CurrentUnderstandingFailure[] = [];

  for (const failure of input.derivedInventory.failures) {
    failures.push({
      code: 'derived-invalid',
      ref: { kind: 'derived-record', ...(failure.id ? { id: failure.id } : {}) },
    });
  }
  for (const failure of input.evaluationInventory.failures) {
    failures.push({
      code: 'evaluation-invalid',
      ref: { kind: 'evaluation', ...(failure.id ? { id: failure.id } : {}) },
    });
  }

  const inScope = evaluations.filter((row) => row.evaluatedAt <= asOf);
  for (const evaluation of inScope) {
    if (!recordIds.has(evaluation.evaluatedRecordId)) {
      failures.push({
        code: 'evaluated-record-missing',
        ref: { kind: 'derived-record', id: evaluation.evaluatedRecordId },
      });
    }
    if (
      evaluation.suppliedRecordId &&
      !recordIds.has(evaluation.suppliedRecordId)
    ) {
      failures.push({
        code: 'supplied-record-missing',
        ref: { kind: 'derived-record', id: evaluation.suppliedRecordId },
      });
    }
  }

  const observerNames =
    perspective.kind === 'all'
      ? observedEvaluatorNames(evaluations, asOf)
      : [perspective.name];

  const entries: CurrentUnderstandingEntry[] = [...records]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((record) => {
      const kind = classifyInterpretationKind(record);
      if (kind === 'unclassified') {
        failures.push({
          code: 'derived-unclassified',
          ref: { kind: 'derived-record', id: record.id },
        });
      }
      const named = observerNames.map((name) => {
        const evidence = reduceDimension(
          evaluations,
          name,
          record.id,
          'evidenceSupport',
          asOf,
        );
        const recognition = reduceDimension(
          evaluations,
          name,
          record.id,
          'personalRecognition',
          asOf,
        );
        return { name, evidence, recognition };
      });
      const currentEvidenceState = aggregateDimension(
        named.map((row) => row.evidence.state),
      ) as EvidenceState;
      const currentRecognitionState = aggregateDimension(
        named.map((row) => row.recognition.state),
      ) as RecognitionState;
      const contributingEvaluationIds = uniqueSorted(
        named.flatMap((row) => [
          ...row.evidence.contributingIds,
          ...row.recognition.contributingIds,
        ]),
      );
      const scoped = inScope.filter((row) => {
        if (row.evaluatedRecordId !== record.id) return false;
        return perspective.kind === 'all'
          ? true
          : row.evaluator.name === perspective.name;
      });
      const candidateSuccessorIds = uniqueSorted(
        scoped
          .map((row) => row.suppliedRecordId)
          .filter((id): id is string => Boolean(id)),
      );
      const explanationIds = uniqueSorted(scoped.map((row) => row.id));
      const entry: CurrentUnderstandingEntry = {
        derivedRecordId: record.id,
        kind,
        currentEvidenceState,
        currentRecognitionState,
        contributingEvaluationIds,
        candidateSuccessorIds,
        explanation: {
          evaluatedRecordId: record.id,
          evaluationIds: explanationIds,
          ...(record.executionId ? { executionId: record.executionId } : {}),
          sourceRefs: record.sourceRefs,
        },
      };
      if (perspective.kind === 'all') {
        entry.perspectiveStates = named.map((row) => ({
          evaluator: { type: 'human' as const, name: row.name },
          evidenceState: row.evidence.state as EvidenceState,
          recognitionState: row.recognition.state as RecognitionState,
          contributingEvaluationIds: uniqueSorted([
            ...row.evidence.contributingIds,
            ...row.recognition.contributingIds,
          ]),
        }));
      }
      return entry;
    });

  const unresolved: CurrentUnderstandingFlag[] = [];
  const conflicts: CurrentUnderstandingFlag[] = [];

  for (const entry of entries) {
    if (entry.currentEvidenceState === 'unassessed') {
      unresolved.push({
        code: 'evidence-unassessed',
        derivedRecordIds: [entry.derivedRecordId],
        evaluationIds: [],
        dimension: 'evidenceSupport',
      });
    }
    if (entry.currentRecognitionState === 'unassessed') {
      unresolved.push({
        code: 'recognition-unassessed',
        derivedRecordIds: [entry.derivedRecordId],
        evaluationIds: [],
        dimension: 'personalRecognition',
      });
    }
    if (entry.candidateSuccessorIds.length > 1) {
      conflicts.push({
        code: 'successor-fork',
        derivedRecordIds: [entry.derivedRecordId],
        evaluationIds: entry.explanation.evaluationIds,
      });
    }
    const states = entry.perspectiveStates ?? [];
    for (const row of states) {
      if (row.evidenceState === 'conflict') {
        conflicts.push({
          code: 'same-evaluator-tie',
          derivedRecordIds: [entry.derivedRecordId],
          evaluationIds: row.contributingEvaluationIds,
          dimension: 'evidenceSupport',
        });
      }
      if (row.recognitionState === 'conflict') {
        conflicts.push({
          code: 'same-evaluator-tie',
          derivedRecordIds: [entry.derivedRecordId],
          evaluationIds: row.contributingEvaluationIds,
          dimension: 'personalRecognition',
        });
      }
    }
    if (perspective.kind === 'evaluator') {
      const evidence = reduceDimension(
        evaluations,
        perspective.name,
        entry.derivedRecordId,
        'evidenceSupport',
        asOf,
      );
      const recognition = reduceDimension(
        evaluations,
        perspective.name,
        entry.derivedRecordId,
        'personalRecognition',
        asOf,
      );
      if (evidence.tie) {
        conflicts.push({
          code: 'same-evaluator-tie',
          derivedRecordIds: [entry.derivedRecordId],
          evaluationIds: evidence.contributingIds,
          dimension: 'evidenceSupport',
        });
      }
      if (recognition.tie) {
        conflicts.push({
          code: 'same-evaluator-tie',
          derivedRecordIds: [entry.derivedRecordId],
          evaluationIds: recognition.contributingIds,
          dimension: 'personalRecognition',
        });
      }
    }
    if (
      perspective.kind === 'all' &&
      entry.currentEvidenceState === 'conflict' &&
      !(entry.perspectiveStates ?? []).some(
        (row) => row.evidenceState === 'conflict',
      )
    ) {
      conflicts.push({
        code: 'cross-evaluator-disagreement',
        derivedRecordIds: [entry.derivedRecordId],
        evaluationIds: entry.contributingEvaluationIds,
        dimension: 'evidenceSupport',
      });
    }
    if (
      perspective.kind === 'all' &&
      entry.currentRecognitionState === 'conflict' &&
      !(entry.perspectiveStates ?? []).some(
        (row) => row.recognitionState === 'conflict',
      )
    ) {
      conflicts.push({
        code: 'cross-evaluator-disagreement',
        derivedRecordIds: [entry.derivedRecordId],
        evaluationIds: entry.contributingEvaluationIds,
        dimension: 'personalRecognition',
      });
    }
  }

  const uniqueFailures = [...failures]
    .sort(compareFailure)
    .filter((row, index, all) => {
      const key = `${row.code}:${row.ref?.kind ?? ''}:${row.ref?.id ?? ''}`;
      return (
        all.findIndex(
          (item) =>
            `${item.code}:${item.ref?.kind ?? ''}:${item.ref?.id ?? ''}` ===
            key,
        ) === index
      );
    });

  return {
    status: uniqueFailures.length > 0 ? 'partial' : 'ok',
    asOf,
    generatedAt,
    asOfSemantics: AS_OF_SEMANTICS,
    perspective,
    policy: CURRENT_UNDERSTANDING_POLICY,
    entries,
    unresolved: unresolved.sort(compareFlag),
    conflicts: conflicts.sort(compareFlag),
    failures: uniqueFailures,
  };
};

export const validateCurrentUnderstandingClock = (
  value: string | undefined,
  code: string,
): string | { error: string } => {
  if (!value) return { error: code };
  if (!isEvaluationTime(value)) return { error: `${code}-invalid` };
  return value;
};
