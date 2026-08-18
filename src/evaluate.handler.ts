import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from './tokens';
import { EvaluateDerivedInput, EvaluateDerivedResult } from './types';
import type { IEvaluationService } from './services/evaluation.service';

/**
 * Entry point for append-only human evaluation of a derived record.
 *
 * Stamps event and persist times when omitted, then dispatches to
 * {@link IEvaluationService}. Holds no review logic and does not
 * generate Activity, Daily Chronicles, or model invocations.
 */
export interface IEvaluateHandler {
  handle(input: EvaluateDerivedInput): Promise<EvaluateDerivedResult>;
}

/**
 * Root handler implementation of {@link IEvaluateHandler}.
 *
 * `evaluatedAt` is the human act's event time. `recordedAt` is
 * persistence time and is not part of evaluation identity. Omitting
 * both defaults them to the same `now` for a contemporaneous CLI
 * write — that equality is not a schema invariant. A reconstructed
 * evaluation may have `evaluatedAt` earlier than `recordedAt`. Daily
 * Chronicle tokens are not injected.
 */
@injectable()
export class EvaluateHandler implements IEvaluateHandler {
  constructor(
    @inject(CHRONICLE_TOKENS.EvaluationService)
    private readonly _evaluationService: IEvaluationService,
  ) {}

  /** @inheritDoc */
  async handle(input: EvaluateDerivedInput): Promise<EvaluateDerivedResult> {
    const now = new Date().toISOString();
    return this._evaluationService.evaluate({
      ...input,
      evaluatedAt: input.evaluatedAt ?? now,
      recordedAt: input.recordedAt ?? now,
    });
  }
}
