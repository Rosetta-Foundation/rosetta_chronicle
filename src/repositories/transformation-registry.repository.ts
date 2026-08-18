import { injectable } from 'inversify';
import { TransformationDefinition } from '../types';
import { DERIVED_TRANSFORMATION_TYPES } from '../utils/derived-record.utils';
import { TRANSFORMATION_RECIPE_VERSION } from '../utils/transformation.utils';

/**
 * Catalog of named transformations the engine can execute.
 *
 * Resource access only — this phase's catalog is in-process. It does
 * not generate content, emit Activity, or encode a Chronicle layout.
 */
export interface ITransformationRegistry {
  get(
    type: string,
    version: string,
  ): TransformationDefinition | null;
  list(): TransformationDefinition[];
}

const definitions = (): TransformationDefinition[] =>
  DERIVED_TRANSFORMATION_TYPES.map((type) => ({
    type,
    version: TRANSFORMATION_RECIPE_VERSION,
    deterministic: true,
    allowedProducerTypes: ['human', 'agent'],
  }));

/**
 * In-memory registry of deterministic, caller-supplied transformations.
 *
 * Every current derived type is registered at recipe version `1`.
 * Nondeterministic AI recipes are not registered.
 */
@injectable()
export class TransformationRegistry implements ITransformationRegistry {
  private readonly _byKey = new Map<string, TransformationDefinition>(
    definitions().map((def) => [`${def.type}@${def.version}`, def]),
  );

  /** @inheritDoc */
  get(type: string, version: string): TransformationDefinition | null {
    return this._byKey.get(`${type}@${version}`) ?? null;
  }

  /** @inheritDoc */
  list(): TransformationDefinition[] {
    return [...this._byKey.values()];
  }
}
