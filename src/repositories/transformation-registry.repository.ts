import { injectable } from 'inversify';
import {
  DerivedTransformationType,
  TransformationRecipe,
} from '../types';
import { DERIVED_TRANSFORMATION_TYPES } from '../utils/derived-record.utils';
import { TRANSFORMATION_RECIPE_VERSION } from '../utils/transformation.utils';

/**
 * In-process bootstrap catalog of named transformations.
 *
 * Resource access only. This is not the durable recipe store —
 * {@link ITransformationDefinitionStore} persists the artifact an
 * execution cites. Does not generate content or emit Activity.
 */
export interface ITransformationRegistry {
  get(type: string, version: string): TransformationRecipe | null;
  list(): TransformationRecipe[];
}

const RECIPE_DESCRIPTION: Record<DerivedTransformationType, string> = {
  'human-note':
    'Caller-supplied note citing source-graph structure.',
  reflection:
    'Caller-supplied reflection citing source-graph structure.',
  summary: 'Caller-supplied summary citing source-graph structure.',
  insight: 'Caller-supplied insight citing source-graph structure.',
  decision:
    'Caller-supplied decision record citing source-graph structure.',
  'activity-candidate':
    'Caller-supplied activity candidate citing source-graph structure. Not Activity.',
  revision:
    'Caller-supplied revision citing source-graph structure.',
};

const recipes = (): TransformationRecipe[] =>
  DERIVED_TRANSFORMATION_TYPES.map((type) => ({
    type,
    version: TRANSFORMATION_RECIPE_VERSION,
    description: RECIPE_DESCRIPTION[type],
    deterministic: true,
    allowedProducerTypes: ['human', 'agent'],
  }));

/**
 * In-memory bootstrap of deterministic, caller-supplied recipes.
 *
 * Every current derived type is registered at recipe version `1`.
 * Nondeterministic AI recipes are not registered. Persisted
 * definitions are written from these rows at transform time.
 */
@injectable()
export class TransformationRegistry implements ITransformationRegistry {
  private readonly _byKey = new Map<string, TransformationRecipe>(
    recipes().map((def) => [`${def.type}@${def.version}`, def]),
  );

  /** @inheritDoc */
  get(type: string, version: string): TransformationRecipe | null {
    return this._byKey.get(`${type}@${version}`) ?? null;
  }

  /** @inheritDoc */
  list(): TransformationRecipe[] {
    return [...this._byKey.values()];
  }
}
