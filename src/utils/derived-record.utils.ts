import {
  ChatGptSourceGraph,
  DerivedProducer,
  DerivedRecord,
  DerivedReviewState,
  DerivedSourceRef,
  DerivedTransformationType,
} from '../types';
import { sha256Hex } from './chatgpt-export.utils';

export const DERIVED_RECORD_VERSION = 'derived-record/1';
export const CONTENT_HASH = /^[a-f0-9]{64}$/;

export const CALLER_SUPPLIED_TRANSFORMATION_TYPES = [
  'human-note',
  'reflection',
  'summary',
  'insight',
  'decision',
  'activity-candidate',
  'revision',
] as const satisfies readonly DerivedTransformationType[];

export const DERIVED_TRANSFORMATION_TYPES = [
  ...CALLER_SUPPLIED_TRANSFORMATION_TYPES,
  'candidate-observation',
] as const satisfies readonly DerivedTransformationType[];

export const DERIVED_REVIEW_STATES = [
  'unreviewed',
  'recognized',
  'rejected',
  'corrected',
  'uncertain',
] as const satisfies readonly DerivedReviewState[];

/**
 * Default review state: human authorship is already an evaluation;
 * agent output stays unreviewed until a later evaluation record.
 */
export const defaultReviewState = (
  producerType: DerivedProducer['type'],
): DerivedReviewState =>
  producerType === 'human' ? 'recognized' : 'unreviewed';

/** Structural problems that block recording. Empty means the draft is valid. */
export const validateDerivedDraft = (input: {
  sourceGraphHash: string;
  nodeIds: string[];
  transformationType: string;
  createdBy: DerivedProducer;
  content: string;
  confidence?: number;
}): string[] => {
  const errors: string[] = [];
  if (!CONTENT_HASH.test(input.sourceGraphHash)) {
    errors.push('source-graph-hash-invalid');
  }
  if (
    !DERIVED_TRANSFORMATION_TYPES.includes(
      input.transformationType as DerivedTransformationType,
    )
  ) {
    errors.push(`unknown-transformation-type:${input.transformationType}`);
  } else if (
    !(CALLER_SUPPLIED_TRANSFORMATION_TYPES as readonly string[]).includes(
      input.transformationType,
    )
  ) {
    errors.push(
      `machine-type-not-caller-supplied:${input.transformationType}`,
    );
  }
  if (!input.createdBy.name.trim()) {
    errors.push('producer-name-missing');
  }
  if (input.createdBy.type === 'agent' && !input.createdBy.model) {
    errors.push('agent-model-missing');
  }
  if (input.createdBy.type !== 'human' && input.createdBy.type !== 'agent') {
    errors.push(`unknown-producer-type:${input.createdBy.type}`);
  }
  if (!input.content) {
    errors.push('content-missing');
  }
  if (
    input.confidence != null &&
    (input.confidence < 0 || input.confidence > 1)
  ) {
    errors.push('confidence-out-of-range');
  }
  for (const id of input.nodeIds) {
    if (!id) errors.push('node-id-empty');
  }
  return errors;
};

/**
 * Confirm declared refs exist on a loaded source graph. Missing graph
 * structure is a validation error, not a silent drop.
 */
export const validateSourceRefsOnGraph = (
  graph: ChatGptSourceGraph,
  ref: DerivedSourceRef,
): string[] => {
  const errors: string[] = [];
  if (graph.archive.contentHash !== ref.sourceGraphHash) {
    errors.push('source-graph-hash-mismatch');
  }
  if (!ref.conversationId) return errors;
  const conv = graph.conversations.find(
    (c) => c.sourceId === ref.conversationId,
  );
  if (!conv) {
    errors.push(`conversation-missing:${ref.conversationId}`);
    return errors;
  }
  const known = new Set(conv.nodes.map((n) => n.id));
  for (const nodeId of ref.nodeIds) {
    if (!known.has(nodeId)) errors.push(`node-missing:${nodeId}`);
  }
  return errors;
};

/**
 * Immutable transformation-event id: refs + type + version + producer +
 * content hash. Not createdAt (same event if re-recorded). Not a
 * conceptual artifact id — a different body or producer is a new event.
 */
export const derivedRecordId = (
  sourceRefs: DerivedSourceRef[],
  transformationType: DerivedTransformationType,
  createdBy: DerivedProducer,
  contentRef: string,
): string =>
  sha256Hex(
    JSON.stringify({
      sourceRefs,
      transformationType,
      transformationVersion: DERIVED_RECORD_VERSION,
      createdBy,
      contentRef,
    }),
  );

/**
 * Build a derived record. Pure: no I/O, no Activity, no Daily Chronicle.
 */
export const buildDerivedRecord = (input: {
  sourceRefs: DerivedSourceRef[];
  transformationType: DerivedTransformationType;
  createdBy: DerivedProducer;
  content: string;
  createdAt: string;
  confidence?: number;
  reviewState: DerivedReviewState;
  executionId?: string;
}): DerivedRecord => {
  const contentRef = sha256Hex(input.content);
  return {
    id: derivedRecordId(
      input.sourceRefs,
      input.transformationType,
      input.createdBy,
      contentRef,
    ),
    sourceRefs: input.sourceRefs,
    transformationType: input.transformationType,
    transformationVersion: DERIVED_RECORD_VERSION,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    contentRef,
    content: input.content,
    ...(input.confidence != null ? { confidence: input.confidence } : {}),
    reviewState: input.reviewState,
    ...(input.executionId ? { executionId: input.executionId } : {}),
  };
};
