import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from './tokens';
import { ObserveCommand } from './types';
import type { IObserveService } from './services/observe.service';

/**
 * CLI entry for V1 raw observe (allowlisted files or directories → private vault).
 *
 * No business logic. Does not interpret source. Does not write Activity.
 */
export interface IObserveHandler {
  handle(command: ObserveCommand): Promise<unknown>;
}

/**
 * Dispatches observe commands to {@link IObserveService}.
 */
@injectable()
export class ObserveHandler implements IObserveHandler {
  constructor(
    @inject(CHRONICLE_TOKENS.ObserveService)
    private readonly _observe: IObserveService,
  ) {}

  /** @inheritDoc */
  async handle(command: ObserveCommand): Promise<unknown> {
    return this._observe.handle(command);
  }
}
