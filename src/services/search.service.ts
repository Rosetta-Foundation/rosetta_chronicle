import { join } from 'path';
import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import {
  LexicalSearchHit,
  LexicalSearchInput,
  LexicalSearchResult,
  LexicalSearchRole,
} from '../types';
import type { IObserveConfigRepository } from '../repositories/observe-config.repository';
import type { IObservationReceiptRepository } from '../repositories/observation-receipt.repository';
import type { ISourceVaultRepository } from '../repositories/source-vault.repository';
import {
  boundSnippet,
  lexicalIndexOf,
  uniqueShardReceipts,
  walkShardNodes,
} from '../utils/lexical-search.utils';

/**
 * Read-only lexical scan of vaulted ChatGPT conversation shards.
 *
 * No standing index. Forgotten scopes are not searchable. Stopped
 * scopes remain searchable — STOP withholds new observe, not evidence.
 */
export interface ISearchService {
  search(input: LexicalSearchInput): Promise<LexicalSearchResult>;
}

const vaultRootOf = (dataDir: string): string => join(dataDir, 'vault');

const isSearchRole = (value: string): value is LexicalSearchRole =>
  value === 'user' || value === 'assistant';

const emptyResult = (
  input: LexicalSearchInput,
  status: LexicalSearchResult['status'],
  elapsedMs: number,
  error?: string,
): LexicalSearchResult => ({
  status,
  query: input.query,
  branchPolicy: 'all-mapping-nodes',
  hitCount: 0,
  hits: [],
  shardsScanned: 0,
  nodesScanned: 0,
  scopesSkippedForgotten: 0,
  elapsedMs,
  ...(error ? { error } : {}),
});

/**
 * Orchestrates config + receipts + vault reads, then applies lexical
 * match and snippet bounds. Does not persist results.
 */
@injectable()
export class SearchService implements ISearchService {
  constructor(
    @inject(CHRONICLE_TOKENS.ObserveConfigRepository)
    private readonly _config: IObserveConfigRepository,
    @inject(CHRONICLE_TOKENS.ObservationReceiptRepository)
    private readonly _receipts: IObservationReceiptRepository,
    @inject(CHRONICLE_TOKENS.SourceVaultRepository)
    private readonly _vault: ISourceVaultRepository,
  ) {}

  /** @inheritDoc */
  async search(input: LexicalSearchInput): Promise<LexicalSearchResult> {
    const started = Date.now();
    const query = input.query.trim();
    if (query.length === 0) {
      return emptyResult(
        { ...input, query },
        'invalid',
        Date.now() - started,
        'empty-query',
      );
    }
    if (input.role !== undefined && !isSearchRole(input.role)) {
      return emptyResult(
        { ...input, query },
        'invalid',
        Date.now() - started,
        'unknown-role',
      );
    }
    const config = await this._config.read(input.dataDir);
    if (!config) {
      return emptyResult(
        { ...input, query },
        'no-config',
        Date.now() - started,
      );
    }

    let skippedForgotten = 0;
    const allowed = new Set<string>();
    for (const scope of config.scopes) {
      if (input.scopeId && scope.id !== input.scopeId) continue;
      if (scope.forgotten) {
        skippedForgotten += 1;
        continue;
      }
      allowed.add(scope.id);
    }
    if (input.scopeId && !allowed.has(input.scopeId)) {
      const named = config.scopes.find((s) => s.id === input.scopeId);
      if (!named) {
        return emptyResult(
          { ...input, query },
          'not-found',
          Date.now() - started,
          'unknown-scope',
        );
      }
    }

    const receipts = uniqueShardReceipts(
      await this._receipts.list(input.dataDir),
      allowed,
    );
    const hits: LexicalSearchHit[] = [];
    let nodesScanned = 0;
    let shardsScanned = 0;
    const limit = Math.max(0, input.limit);
    const snippetChars = Math.max(0, input.snippetChars);

    for (const receipt of receipts) {
      if (hits.length >= limit) break;
      const bytes = await this._vault.get(
        vaultRootOf(input.dataDir),
        receipt.contentHash,
      );
      shardsScanned += 1;
      if (!bytes) continue;
      const nodes = walkShardNodes(bytes);
      for (const node of nodes) {
        nodesScanned += 1;
        if (hits.length >= limit) break;
        if (lexicalIndexOf(node.text, query) < 0) continue;
        if (input.role && node.role !== input.role) continue;
        hits.push({
          scopeId: receipt.scopeId,
          conversationId: node.conversationId,
          nodeId: node.nodeId,
          ...(node.role ? { role: node.role } : {}),
          ...(node.eventTime ? { eventTime: node.eventTime } : {}),
          contentHash: receipt.contentHash,
          snippet: boundSnippet(node.text, query, snippetChars),
        });
      }
    }

    return {
      status: 'ok',
      query,
      branchPolicy: 'all-mapping-nodes',
      hitCount: hits.length,
      hits,
      shardsScanned,
      nodesScanned,
      scopesSkippedForgotten: skippedForgotten,
      elapsedMs: Date.now() - started,
    };
  }
}
