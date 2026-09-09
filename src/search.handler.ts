import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from './tokens';
import { LexicalSearchInput, LexicalSearchResult } from './types';
import type { ISearchService } from './services/search.service';

/**
 * Entry point for local lexical conversation search.
 *
 * Parses nothing beyond dispatch. Does not write, index, or call a
 * model. Forgotten-scope policy lives in the service.
 */
export interface ISearchHandler {
  handle(input: LexicalSearchInput): Promise<LexicalSearchResult>;
}

/**
 * Root handler implementation of {@link ISearchHandler}.
 */
@injectable()
export class SearchHandler implements ISearchHandler {
  constructor(
    @inject(CHRONICLE_TOKENS.SearchService)
    private readonly _search: ISearchService,
  ) {}

  /** @inheritDoc */
  async handle(input: LexicalSearchInput): Promise<LexicalSearchResult> {
    return this._search.search(input);
  }
}
