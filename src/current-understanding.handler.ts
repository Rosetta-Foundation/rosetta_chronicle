import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from './tokens';
import {
  CurrentUnderstandingInput,
  CurrentUnderstandingView,
} from './types';
import type { ICurrentUnderstandingService } from './services/current-understanding.service';

/**
 * Entry point for the read-only current-understanding view.
 *
 * Stamps `asOf` and `generatedAt` when omitted, then dispatches.
 * Holds no reduction logic and does not write, invoke a model, or
 * emit Activity / Daily Chronicle.
 */
export interface ICurrentUnderstandingHandler {
  handle(input: CurrentUnderstandingInput): Promise<CurrentUnderstandingView>;
}

/**
 * Root handler implementation of {@link ICurrentUnderstandingHandler}.
 *
 * Default `asOf` is query time. That default is still effective
 * event-time over history currently available, not known-at-T.
 */
@injectable()
export class CurrentUnderstandingHandler implements ICurrentUnderstandingHandler {
  constructor(
    @inject(CHRONICLE_TOKENS.CurrentUnderstandingService)
    private readonly _currentUnderstanding: ICurrentUnderstandingService,
  ) {}

  /** @inheritDoc */
  async handle(
    input: CurrentUnderstandingInput,
  ): Promise<CurrentUnderstandingView> {
    const now = new Date().toISOString();
    return this._currentUnderstanding.project({
      ...input,
      asOf: input.asOf ?? now,
      generatedAt: input.generatedAt ?? now,
    });
  }
}
