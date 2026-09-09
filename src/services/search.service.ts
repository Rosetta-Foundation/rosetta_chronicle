import { join } from 'path';
import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import {
  LexicalSearchHit,
  LexicalSearchInput,
  LexicalSearchMatchMode,
  LexicalSearchResult,
  LexicalSearchRole,
} from '../types';
import type { IObserveConfigRepository } from '../repositories/observe-config.repository';
import type { IObservationReceiptRepository } from '../repositories/observation-receipt.repository';
import type { ISourceVaultRepository } from '../repositories/source-vault.repository';
import {
  boundSnippet,
  lexicalIndexOf,
  normalizeLexicalText,
  uniqueShardReceipts,
  walkShardNodes,
} from '../utils/lexical-search.utils';

/**
 * Read-only lexical scan of vaulted ChatGPT conversation shards.
 *
 * No standing index. Forgotten scopes are not searchable. Stopped
 * scopes remain searchable — STOP withholds new observe, not evidence.
 * `--match normalized` rewrites query and haystack visibly; it does
 * not replace `raw`.
 */
export interface ISearchService {
  search(input: LexicalSearchInput): Promise<LexicalSearchResult>;
}

const vaultRootOf = (dataDir: string): string => join(dataDir, 'vault');

const isSearchRole = (value: string): value is LexicalSearchRole =>
  value === 'user' || value === 'assistant';

const isMatchMode = (value: string): value is LexicalSearchMatchMode =>
  value === 'raw' || value === 'normalized';

const emptyResult = (
  input: LexicalSearchInput,
  status: LexicalSearchResult['status'],
  elapsedMs: number,
  extras?: { error?: string; normalizedQuery?: string },
): LexicalSearchResult => ({
  status,
  query: input.query,
  matchMode: input.matchMode ?? 'raw',
  ...(extras?.normalizedQuery !== undefined
    ? { normalizedQuery: extras.normalizedQuery }
    : {}),
  branchPolicy: 'all-mapping-nodes',
  hitCount: 0,
  hits: [],
  shardsScanned: 0,
  nodesScanned: 0,
  scopesSkippedForgotten: 0,
  elapsedMs,
  ...(extras?.error ? { error: extras.error } : {}),
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
    const matchMode: LexicalSearchMatchMode = input.matchMode ?? 'raw';
    const tagged = { ...input, query, matchMode };
    if (query.length === 0) {
      return emptyResult(tagged, 'invalid', Date.now() - started, {
        error: 'empty-query',
      });
    }
    if (!isMatchMode(matchMode)) {
      return emptyResult(tagged, 'invalid', Date.now() - started, {
        error: 'unknown-match-mode',
      });
    }
    if (input.role !== undefined && !isSearchRole(input.role)) {
      return emptyResult(tagged, 'invalid', Date.now() - started, {
        error: 'unknown-role',
      });
    }
    const normalizedQuery =
      matchMode === 'normalized' ? normalizeLexicalText(query) : undefined;
    if (matchMode === 'normalized' && !normalizedQuery) {
      return emptyResult(tagged, 'invalid', Date.now() - started, {
        error: 'empty-normalized-query',
        normalizedQuery: '',
      });
    }
    const config = await this._config.read(input.dataDir);
    if (!config) {
      return emptyResult(tagged, 'no-config', Date.now() - started, {
        ...(normalizedQuery !== undefined ? { normalizedQuery } : {}),
      });
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
        return emptyResult(tagged, 'not-found', Date.now() - started, {
          error: 'unknown-scope',
          ...(normalizedQuery !== undefined ? { normalizedQuery } : {}),
        });
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
        const haystack =
          matchMode === 'normalized'
            ? normalizeLexicalText(node.text)
            : node.text;
        const needle = normalizedQuery ?? query;
        if (lexicalIndexOf(haystack, needle) < 0) continue;
        if (input.role && node.role !== input.role) continue;
        hits.push({
          scopeId: receipt.scopeId,
          conversationId: node.conversationId,
          nodeId: node.nodeId,
          ...(node.role ? { role: node.role } : {}),
          ...(node.eventTime ? { eventTime: node.eventTime } : {}),
          contentHash: receipt.contentHash,
          snippet: boundSnippet(haystack, needle, snippetChars),
        });
      }
    }

    return {
      status: 'ok',
      query,
      matchMode,
      ...(normalizedQuery !== undefined ? { normalizedQuery } : {}),
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
