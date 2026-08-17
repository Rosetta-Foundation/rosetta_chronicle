import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import { ChatGptImportResult, ChatGptSourceGraph } from '../types';
import type { IChatGptExportRepository } from '../repositories/chatgpt-export.repository';
import type { IChatGptGraphStore } from '../repositories/chatgpt-graph-store.repository';
import { buildSourceGraph } from '../utils/chatgpt-export.utils';

/**
 * Orchestrates ChatGPT source-graph import into a caller-chosen directory.
 *
 * Builds the normalized conversation graph from a stripped export and
 * persists it keyed by archive content hash. Re-import of the same hash
 * is a no-op and keeps the original `importedAt`. Does not emit Activity,
 * does not write Daily Chronicles, and does not copy source bytes. The
 * output directory is configuration, not an engine layout.
 */
export interface IChatGptImportService {
  importGraph(
    exportPath: string,
    outputDir: string,
    importedAt: string,
    dryRun: boolean,
  ): Promise<ChatGptImportResult>;
}

/**
 * Import implementation of {@link IChatGptImportService}.
 *
 * The export repository owns stripping. This service maps the read onto
 * {@link ChatGptSourceGraph}, then asks the graph store to persist it.
 * Missing and invalid archives are first-class statuses. Idempotency is
 * by content hash: an existing graph is returned, not overwritten.
 */
@injectable()
export class ChatGptImportService implements IChatGptImportService {
  constructor(
    @inject(CHRONICLE_TOKENS.ChatGptExportRepository)
    private readonly _exportRepo: IChatGptExportRepository,
    @inject(CHRONICLE_TOKENS.ChatGptGraphStore)
    private readonly _graphStore: IChatGptGraphStore,
  ) {}

  /** @inheritDoc */
  async importGraph(
    exportPath: string,
    outputDir: string,
    importedAt: string,
    dryRun: boolean,
  ): Promise<ChatGptImportResult> {
    const read = await this._exportRepo.read(exportPath);
    if (!read.ok) {
      return {
        status: read.reason,
        conversationCount: 0,
        nodeCount: 0,
        error: read.message,
      };
    }

    const existing = await this._graphStore.read(
      outputDir,
      read.export.contentHash,
    );
    if (existing && existing.archive.contentHash === read.export.contentHash) {
      return this.toResult(
        'already-present',
        existing,
        this._graphStore.pathFor(outputDir, existing.archive.contentHash),
      );
    }

    const graph = buildSourceGraph(read.export, importedAt);
    const intended = this._graphStore.pathFor(
      outputDir,
      graph.archive.contentHash,
    );
    if (dryRun) {
      return this.toResult('imported', graph, intended);
    }

    const written = await this._graphStore.write(outputDir, graph);
    return this.toResult('imported', graph, written);
  }

  private toResult(
    status: 'imported' | 'already-present',
    graph: ChatGptSourceGraph,
    filePath: string,
  ): ChatGptImportResult {
    let nodeCount = 0;
    for (const conv of graph.conversations) nodeCount += conv.nodes.length;
    return {
      status,
      contentHash: graph.archive.contentHash,
      path: filePath,
      conversationCount: graph.conversations.length,
      nodeCount,
      importedAt: graph.archive.importedAt,
    };
  }
}
