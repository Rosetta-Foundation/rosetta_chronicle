import { injectable } from 'inversify';
import {
  DerivedTransformationType,
  TransformationRecipe,
} from '../types';
import { CALLER_SUPPLIED_TRANSFORMATION_TYPES } from '../utils/derived-record.utils';
import {
  CANDIDATE_OBSERVATION_POLICY,
  CANDIDATE_OBSERVATION_TYPE,
} from '../utils/interpretation-policy.utils';
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

const RECIPE_DESCRIPTION: Record<
  (typeof CALLER_SUPPLIED_TRANSFORMATION_TYPES)[number],
  string
> = {
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

const candidateObservationRecipe = (): TransformationRecipe => ({
  type: CANDIDATE_OBSERVATION_TYPE,
  version: TRANSFORMATION_RECIPE_VERSION,
  description:
    'Machine-produced candidate observations from explicitly cited source nodes. Distinguishes directly-supported from inferred. Directly-supported remains a machine classification, not source truth. May return insufficient-evidence. Nondeterministic. Agent only.',
  deterministic: false,
  allowedProducerTypes: ['agent'],
  policy: CANDIDATE_OBSERVATION_POLICY,
});

const recipes = (): TransformationRecipe[] => [
  ...CALLER_SUPPLIED_TRANSFORMATION_TYPES.map((type) => ({
    type: type as DerivedTransformationType,
    version: TRANSFORMATION_RECIPE_VERSION,
    description: RECIPE_DESCRIPTION[type],
    deterministic: true,
    allowedProducerTypes: ['human' as const, 'agent' as const],
  })),
  candidateObservationRecipe(),
];

/**
 * In-memory bootstrap of named recipes.
 *
 * Caller-supplied types remain deterministic at version `1`.
 * `candidate-observation` is the E4 nondeterministic agent recipe.
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
};
