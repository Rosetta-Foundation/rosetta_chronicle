import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from './tokens';
import { InterpretSourceInput, InterpretSourceResult } from './types';
import type { IInterpretationService } from './services/interpretation.service';

/**
 * Entry point for machine interpretation with provenance.
 *
 * Stamps artifact `createdAt` when omitted and dispatches to
 * {@link IInterpretationService}. Does not stamp occurrence `startedAt`
 * or `nonce` — those identify the physical provider call and are
 * defaulted immediately before invoke. Holds no policy logic and does
 * not generate Activity or Daily Chronicles.
 */
export interface IInterpretHandler {
  handle(input: InterpretSourceInput): Promise<InterpretSourceResult>;
}

/**
 * Root handler implementation of {@link IInterpretHandler}.
 *
 * `createdAt` is request/artifact time. Occurrence clocks stay unset
 * unless the caller pins them for tests.
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
    return this._interpretationService.interpret({
      ...input,
      createdAt,
    });
  }
}
