import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from './tokens';
import {
  ProvenanceQuery,
  ProvenanceResult,
  TransformRecordInput,
  TransformRecordResult,
} from './types';
import type { ITransformationService } from './services/transformation.service';

/**
 * Entry point for named transformations and execution provenance.
 *
 * Stamps `createdAt` when omitted and dispatches to
 * {@link ITransformationService}. Holds no recipe logic and does not
 * generate Activity or Daily Chronicles.
 */
export interface ITransformationHandler {
  handle(input: TransformRecordInput): Promise<TransformRecordResult>;
  provenance(query: ProvenanceQuery): Promise<ProvenanceResult>;
}

/**
 * Root handler implementation of {@link ITransformationHandler}.
 *
 * Creation time is a request field. The handler defaults it to now so
 * tests can pin a stable value. Daily Chronicle tokens are not injected.
 */
@injectable()
export class TransformationHandler implements ITransformationHandler {
  constructor(
    @inject(CHRONICLE_TOKENS.TransformationService)
    private readonly _transformationService: ITransformationService,
  ) {}

  /** @inheritDoc */
  async handle(
    input: TransformRecordInput,
  ): Promise<TransformRecordResult> {
    const createdAt = input.createdAt ?? new Date().toISOString();
    return this._transformationService.transform({ ...input, createdAt });
  }

  /** @inheritDoc */
  async provenance(query: ProvenanceQuery): Promise<ProvenanceResult> {
    return this._transformationService.provenance(query);
  }
}
