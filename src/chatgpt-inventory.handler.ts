import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from './tokens';
import { ChatGptExportInventory, ChatGptInventoryInput } from './types';
import type { IChatGptInventoryService } from './services/chatgpt-inventory.service';

/**
 * Entry point for a read-only ChatGPT export inventory (PRD-0027 Phase 1).
 *
 * Parses the request, stamps ingestion time when the caller omitted it, and
 * dispatches to {@link IChatGptInventoryService}. Holds no inventory logic
 * and never writes a Chronicle.
 */
export interface IChatGptInventoryHandler {
  handle(input: ChatGptInventoryInput): Promise<ChatGptExportInventory>;
}

/**
 * Root handler implementation of {@link IChatGptInventoryHandler}.
 *
 * Ingestion time is a request field, not an event timestamp. The handler
 * defaults it to now so tests can pin a stable value without mocking clocks
 * in the service. Persistence tokens are intentionally not injected.
 */
@injectable()
export class ChatGptInventoryHandler implements IChatGptInventoryHandler {
  constructor(
    @inject(CHRONICLE_TOKENS.ChatGptInventoryService)
    private readonly _inventoryService: IChatGptInventoryService,
  ) {}

  /** @inheritDoc */
  async handle(input: ChatGptInventoryInput): Promise<ChatGptExportInventory> {
    const ingestedAt = input.ingestedAt ?? new Date().toISOString();
    return this._inventoryService.inventory(input.exportPath, ingestedAt);
  }
}
