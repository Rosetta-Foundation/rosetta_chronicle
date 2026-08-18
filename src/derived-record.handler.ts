import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from './tokens';
import { DerivedRecordInput, DerivedRecordResult } from './types';
import type { IDerivedRecordService } from './services/derived-record.service';

/**
 * Entry point for provenance-preserving derived records (PRD-0027).
 *
 * Parses the request, stamps `createdAt` when omitted, and dispatches to
 * {@link IDerivedRecordService}. Holds no transformation logic and does
 * not generate Activity or Daily Chronicles.
 */
export interface IDerivedRecordHandler {
  handle(input: DerivedRecordInput): Promise<DerivedRecordResult>;
}

/**
 * Root handler implementation of {@link IDerivedRecordHandler}.
 *
 * Creation time is a request field. The handler defaults it to now so
 * tests can pin a stable value. Daily Chronicle tokens are not injected.
 */
@injectable()
export class DerivedRecordHandler implements IDerivedRecordHandler {
  constructor(
    @inject(CHRONICLE_TOKENS.DerivedRecordService)
    private readonly _derivedService: IDerivedRecordService,
  ) {}

  /** @inheritDoc */
  async handle(input: DerivedRecordInput): Promise<DerivedRecordResult> {
    const createdAt = input.createdAt ?? new Date().toISOString();
    return this._derivedService.record({ ...input, createdAt });
  }
}
