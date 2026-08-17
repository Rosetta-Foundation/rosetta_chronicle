import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from './tokens';
import { ChatGptImportInput, ChatGptImportResult } from './types';
import type { IChatGptImportService } from './services/chatgpt-import.service';

/**
 * Entry point for ChatGPT source-graph import (PRD-0027 Phase 2).
 *
 * Parses the request, stamps ingestion time when the caller omitted it,
 * and dispatches to {@link IChatGptImportService}. Holds no import logic
 * and does not generate Activity or Daily Chronicles.
 */
export interface IChatGptImportHandler {
  handle(input: ChatGptImportInput): Promise<ChatGptImportResult>;
}

/**
 * Root handler implementation of {@link IChatGptImportHandler}.
 *
 * Ingestion time is a request field, not an event timestamp. The handler
 * defaults it to now so tests can pin a stable value. Daily Chronicle
 * tokens are intentionally not injected.
 */
@injectable()
export class ChatGptImportHandler implements IChatGptImportHandler {
  constructor(
    @inject(CHRONICLE_TOKENS.ChatGptImportService)
    private readonly _importService: IChatGptImportService,
  ) {}

  /** @inheritDoc */
  async handle(input: ChatGptImportInput): Promise<ChatGptImportResult> {
    const importedAt = input.ingestedAt ?? new Date().toISOString();
    return this._importService.importGraph(
      input.exportPath,
      input.repoPath,
      importedAt,
      input.dryRun === true,
    );
  }
}
