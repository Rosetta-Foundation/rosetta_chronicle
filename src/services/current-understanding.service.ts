import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import {
  CurrentUnderstandingInput,
  CurrentUnderstandingView,
} from '../types';
import type { IDerivedRecordStore } from '../repositories/derived-record-store.repository';
import type { IEvaluationStore } from '../repositories/evaluation-store.repository';
import {
  parseCurrentUnderstandingPerspective,
  projectCurrentUnderstanding,
  validateCurrentUnderstandingClock,
} from '../utils/current-understanding.utils';

/**
 * Read-only current-understanding projection.
 *
 * Orchestrates store inventories and the deterministic util. Does not
 * write, invoke a model, call other services, or read directories.
 * `ok` requires both inventories to be structurally clean.
 */
export interface ICurrentUnderstandingService {
  project(
    input: CurrentUnderstandingInput,
  ): Promise<CurrentUnderstandingView>;
}

/**
 * Service implementation of {@link ICurrentUnderstandingService}.
 *
 * Uses `listResolved` so unreferenced corrupt files cannot disappear
 * into a silent `ok`. Missing directories are `not-found`. Invalid
 * perspective or clocks are `invalid`.
 */
@injectable()
export class CurrentUnderstandingService implements ICurrentUnderstandingService {
  constructor(
    @inject(CHRONICLE_TOKENS.DerivedRecordStore)
    private readonly _derivedStore: IDerivedRecordStore,
    @inject(CHRONICLE_TOKENS.EvaluationStore)
    private readonly _evaluationStore: IEvaluationStore,
  ) {}

  /** @inheritDoc */
  async project(
    input: CurrentUnderstandingInput,
  ): Promise<CurrentUnderstandingView> {
    const parsed = parseCurrentUnderstandingPerspective(input);
    const asOf = validateCurrentUnderstandingClock(
      input.asOf,
      'as-of-missing',
    );
    const generatedAt = validateCurrentUnderstandingClock(
      input.generatedAt,
      'generated-at-missing',
    );
    if ('error' in parsed) {
      return emptyInvalid(parsed.error, input);
    }
    if (typeof asOf !== 'string') {
      return emptyInvalid(asOf.error, input);
    }
    if (typeof generatedAt !== 'string') {
      return emptyInvalid(generatedAt.error, input);
    }

    const derivedInventory = await this._derivedStore.listResolved(
      input.outputDir,
    );
    const evaluationInventory = await this._evaluationStore.listResolved(
      input.evaluationsDir,
    );
    if (!derivedInventory.present || !evaluationInventory.present) {
      return {
        ...emptyInvalid('store-missing', input),
        status: 'not-found',
        asOf,
        generatedAt,
        perspective: parsed.perspective,
      };
    }

    return projectCurrentUnderstanding({
      records: derivedInventory.records,
      evaluations: evaluationInventory.records,
      derivedInventory,
      evaluationInventory,
      perspective: parsed.perspective,
      asOf,
      generatedAt,
    });
  }
}

const emptyInvalid = (
  _error: string,
  input: CurrentUnderstandingInput,
): CurrentUnderstandingView => ({
  status: 'invalid',
  asOf: input.asOf ?? '',
  generatedAt: input.generatedAt ?? '',
  asOfSemantics: 'effective-event-time',
  perspective: input.perspectiveAll
    ? { kind: 'all' }
    : { kind: 'evaluator', name: input.evaluatorName ?? '' },
  policy: { id: 'current-understanding', version: '1' },
  entries: [],
  unresolved: [],
  conflicts: [],
  failures: [{ code: _error }],
});
