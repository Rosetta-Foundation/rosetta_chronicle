import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import { ChatGptExportInventory } from '../types';
import type { IChatGptExportRepository } from '../repositories/chatgpt-export.repository';
import { buildInventory } from '../utils/chatgpt-export.utils';

/**
 * Orchestrates a read-only ChatGPT export inventory.
 *
 * Distinguishes missing and invalid archives from a successful derived
 * inventory, and keeps ingestion time separate from event time. Does not
 * persist, does not emit Activity, and does not call Chronicle synthesis.
 */
export interface IChatGptInventoryService {
  inventory(
    exportPath: string,
    ingestedAt: string,
  ): Promise<ChatGptExportInventory>;
}

/**
 * Inventory implementation of {@link IChatGptInventoryService}.
 *
 * The repository owns filesystem access and content stripping. This service
 * maps the read result onto {@link ChatGptExportInventory} and aggregates
 * structural counts. A missing or invalid export is a first-class status,
 * not an empty successful inventory.
 */
@injectable()
export class ChatGptInventoryService implements IChatGptInventoryService {
  constructor(
    @inject(CHRONICLE_TOKENS.ChatGptExportRepository)
    private readonly _exportRepo: IChatGptExportRepository,
  ) {}

  /** @inheritDoc */
  async inventory(
    exportPath: string,
    ingestedAt: string,
  ): Promise<ChatGptExportInventory> {
    const read = await this._exportRepo.read(exportPath);
    if (!read.ok) {
      return {
        status: read.reason,
        sourcePath: exportPath,
        ingestedAt,
        conversationCount: 0,
        nodeCount: 0,
        messageNodeCount: 0,
        roleCounts: {},
        contentTypes: [],
        attachmentRefCount: 0,
        attachmentsPresent: 0,
        attachmentsMissing: 0,
        conversationsWithBranches: 0,
        shardCount: 0,
        sidecarFiles: [],
        privacySignals: [],
        unsupported: [],
        conversations: [],
        error: read.message,
      };
    }
    return buildInventory(read.export, exportPath, ingestedAt);
  }
}
