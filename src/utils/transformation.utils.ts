import {
  DerivedProducer,
  DerivedSourceRef,
  DerivedTransformationType,
  InterpretationPolicy,
  ProvenanceDifference,
  TransformationDefinition,
  TransformationExecution,
  TransformationRecipe,
} from '../types';
import { sha256Hex } from './chatgpt-export.utils';
import { CONTENT_HASH } from './derived-record.utils';

/** Recipe version for every type registered in this phase. */
export const TRANSFORMATION_RECIPE_VERSION = '1';

const RECIPE_VERSION = /^[0-9]+$/;

const stablePolicy = (
  policy: InterpretationPolicy,
): InterpretationPolicy => ({
  id: policy.id,
  version: policy.version,
  maxObservations: policy.maxObservations,
  epistemicClasses: [...policy.epistemicClasses],
  outputSchemaId: policy.outputSchemaId,
  promptTemplateId: policy.promptTemplateId,
  promptTemplateHash: policy.promptTemplateHash,
});

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
 * Immutable definition id: recipe fields only. Not createdAt. Changing
 * description or flags is a new artifact, even if type@version matches.
 */
export const transformationDefinitionHash = (
  recipe: TransformationRecipe,
): string =>
  sha256Hex(
    JSON.stringify({
      type: recipe.type,
      version: recipe.version,
      description: recipe.description,
      deterministic: recipe.deterministic,
      allowedProducerTypes: [...recipe.allowedProducerTypes].sort(),
      ...(recipe.policy ? { policy: stablePolicy(recipe.policy) } : {}),
    }),
  );

/** Persist a bootstrap recipe. `createdAt` is not part of identity. */
export const buildTransformationDefinition = (
  recipe: TransformationRecipe,
  createdAt: string,
): TransformationDefinition => {
  const contentHash = transformationDefinitionHash(recipe);
  return {
    id: contentHash,
    type: recipe.type,
    version: recipe.version,
    description: recipe.description,
    deterministic: recipe.deterministic,
    allowedProducerTypes: [...recipe.allowedProducerTypes],
    createdAt,
    contentHash,
    ...(recipe.policy ? { policy: stablePolicy(recipe.policy) } : {}),
  };
};

/** Structural problems that block persisting a definition. */
export const validateTransformationDefinition = (
  definition: TransformationDefinition,
): string[] => {
  const errors: string[] = [];
  if (!CONTENT_HASH.test(definition.id)) {
    errors.push('definition-id-invalid');
  }
  if (!CONTENT_HASH.test(definition.contentHash)) {
    errors.push('definition-hash-invalid');
  }
  const expected = transformationDefinitionHash(definition);
  if (definition.contentHash !== expected) {
    errors.push('definition-hash-mismatch');
  }
  if (definition.id !== definition.contentHash) {
    errors.push('definition-id-hash-mismatch');
  }
  if (!definition.description.trim()) {
    errors.push('definition-description-missing');
  }
  if (definition.allowedProducerTypes.length === 0) {
    errors.push('definition-producers-missing');
  }
  if (!RECIPE_VERSION.test(definition.version)) {
    errors.push(`unknown-transformation-version:${definition.version}`);
  }
  return errors;
};

/**
 * Immutable execution id: definition + refs + producer + configuration
 * + output content hashes. Not createdAt. Not derived-record ids.
 */
export const transformationExecutionId = (input: {
  definitionId: string;
  transformationType: DerivedTransformationType;
  transformationVersion: string;
  sourceRefs: DerivedSourceRef[];
  producer: DerivedProducer;
  configuration: Record<string, unknown>;
  outputContentRefs: string[];
}): string =>
  sha256Hex(
    JSON.stringify({
      definitionId: input.definitionId,
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
  definitionId: string;
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
    definitionId: input.definitionId,
    transformationType: input.transformationType,
    transformationVersion: input.transformationVersion,
    sourceRefs: input.sourceRefs,
    producer: input.producer,
    configuration: input.configuration,
    outputContentRefs: input.outputContentRefs,
  }),
  definitionId: input.definitionId,
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
    compareField('definitionId', left.definitionId, right.definitionId),
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
