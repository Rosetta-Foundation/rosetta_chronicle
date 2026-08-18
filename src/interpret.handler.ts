import { randomBytes } from 'crypto';
import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from './tokens';
import { InterpretSourceInput, InterpretSourceResult } from './types';
import type { IInterpretationService } from './services/interpretation.service';

/**
 * Entry point for machine interpretation with provenance.
 *
 * Stamps clocks and nonce when omitted and dispatches to
 * {@link IInterpretationService}. Holds no policy logic and does not
 * generate Activity or Daily Chronicles. Always leaves review to the
 * service (unreviewed).
 */
export interface IInterpretHandler {
  handle(input: InterpretSourceInput): Promise<InterpretSourceResult>;
}

/**
 * Root handler implementation of {@link IInterpretHandler}.
 *
 * Creation time and occurrence clocks are request fields. The handler
 * defaults them so tests can pin stable values.
 */
@injectable()
export class InterpretHandler implements IInterpretHandler {
  constructor(
    @inject(CHRONICLE_TOKENS.InterpretationService)
    private readonly _interpretationService: IInterpretationService,
  ) {}

  /** @inheritDoc */
  async handle(
    input: InterpretSourceInput,
  ): Promise<InterpretSourceResult> {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const startedAt = input.startedAt ?? createdAt;
    const nonce = input.nonce ?? randomBytes(16).toString('hex');
    return this._interpretationService.interpret({
      ...input,
      createdAt,
      startedAt,
      nonce,
    });
  }
}
