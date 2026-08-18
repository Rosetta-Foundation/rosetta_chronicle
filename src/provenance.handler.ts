import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from './tokens';
import {
  ProvenanceTraverseInput,
  ProvenanceTraverseResult,
} from './types';
import type { IProvenanceService } from './services/provenance.service';

/**
 * Entry point for first-class provenance graph traversal.
 *
 * Dispatches to {@link IProvenanceService}. Holds no walk logic and
 * does not generate Activity or Daily Chronicles.
 */
export interface IProvenanceHandler {
  handle(input: ProvenanceTraverseInput): Promise<ProvenanceTraverseResult>;
}

/**
 * Root handler implementation of {@link IProvenanceHandler}.
 *
 * Directories are request fields. Daily Chronicle tokens are not
 * injected. `transformation-provenance` stays on the transformation
 * handler as the narrow compatibility helper.
 */
@injectable()
export class ProvenanceHandler implements IProvenanceHandler {
  constructor(
    @inject(CHRONICLE_TOKENS.ProvenanceService)
    private readonly _provenanceService: IProvenanceService,
  ) {}

  /** @inheritDoc */
  async handle(
    input: ProvenanceTraverseInput,
  ): Promise<ProvenanceTraverseResult> {
    return this._provenanceService.traverse(input);
  }
}
