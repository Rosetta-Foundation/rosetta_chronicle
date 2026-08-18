import {
  DerivedProducer,
  DerivedSourceRef,
  DerivedTransformationType,
  ProvenanceDifference,
  TransformationExecution,
} from '../types';
import { sha256Hex } from './chatgpt-export.utils';
import { CONTENT_HASH } from './derived-record.utils';

/** Recipe version for every type registered in this phase. */
export const TRANSFORMATION_RECIPE_VERSION = '1';

const RECIPE_VERSION = /^[0-9]+$/;

/** Sort object keys so configuration hashing is stable. */
export const stableObject = (
  value: Record<string, unknown>,
): Record<string, unknown> => {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key];
  }
  return sorted;
};

/**
 * Immutable execution id: recipe + refs + producer + configuration +
 * output content hashes. Not createdAt. Not derived-record ids (those
 * are assigned after content hashes exist).
 */
export const transformationExecutionId = (input: {
  transformationType: DerivedTransformationType;
  transformationVersion: string;
  sourceRefs: DerivedSourceRef[];
  producer: DerivedProducer;
  configuration: Record<string, unknown>;
  outputContentRefs: string[];
}): string =>
  sha256Hex(
    JSON.stringify({
      transformationType: input.transformationType,
      transformationVersion: input.transformationVersion,
      sourceRefs: input.sourceRefs,
      producer: input.producer,
      configuration: stableObject(input.configuration),
      outputContentRefs: [...input.outputContentRefs].sort(),
    }),
  );

/** Structural problems that block a named transformation. */
export const validateTransformationDraft = (input: {
  sourceGraphHash: string;
  transformationVersion: string;
  configuration?: Record<string, unknown>;
}): string[] => {
  const errors: string[] = [];
  if (!CONTENT_HASH.test(input.sourceGraphHash)) {
    errors.push('source-graph-hash-invalid');
  }
  if (!RECIPE_VERSION.test(input.transformationVersion)) {
    errors.push(
      `unknown-transformation-version:${input.transformationVersion}`,
    );
  }
  if (
    input.configuration != null &&
    (typeof input.configuration !== 'object' ||
      Array.isArray(input.configuration))
  ) {
    errors.push('configuration-not-object');
  }
  return errors;
};

/**
 * Build an execution. Pure: no I/O, no Activity, no Daily Chronicle.
 * `outputRefs` must already be the derived-record ids for the contents
 * whose hashes are `outputContentRefs`.
 */
export const buildTransformationExecution = (input: {
  transformationType: DerivedTransformationType;
  transformationVersion: string;
  sourceRefs: DerivedSourceRef[];
  producer: DerivedProducer;
  createdAt: string;
  configuration: Record<string, unknown>;
  deterministic: boolean;
  outputRefs: string[];
  outputContentRefs: string[];
}): TransformationExecution => ({
  id: transformationExecutionId({
    transformationType: input.transformationType,
    transformationVersion: input.transformationVersion,
    sourceRefs: input.sourceRefs,
    producer: input.producer,
    configuration: input.configuration,
    outputContentRefs: input.outputContentRefs,
  }),
  transformationType: input.transformationType,
  transformationVersion: input.transformationVersion,
  sourceRefs: input.sourceRefs,
  producer: input.producer,
  createdAt: input.createdAt,
  configuration: stableObject(input.configuration),
  deterministic: input.deterministic,
  outputRefs: input.outputRefs,
  outputContentRefs: [...input.outputContentRefs].sort(),
});

const compareField = (
  field: string,
  a: unknown,
  b: unknown,
): ProvenanceDifference | null => {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  return { field, a, b };
};

/**
 * Fields that would make a re-run a different execution. `createdAt`
 * is omitted — it is not part of identity.
 */
export const diffExecutions = (
  left: TransformationExecution,
  right: TransformationExecution,
): ProvenanceDifference[] =>
  [
    compareField(
      'transformationType',
      left.transformationType,
      right.transformationType,
    ),
    compareField(
      'transformationVersion',
      left.transformationVersion,
      right.transformationVersion,
    ),
    compareField('sourceRefs', left.sourceRefs, right.sourceRefs),
    compareField('producer', left.producer, right.producer),
    compareField(
      'configuration',
      left.configuration,
      right.configuration,
    ),
    compareField(
      'outputContentRefs',
      left.outputContentRefs,
      right.outputContentRefs,
    ),
    compareField('deterministic', left.deterministic, right.deterministic),
  ].filter((row): row is ProvenanceDifference => row != null);
