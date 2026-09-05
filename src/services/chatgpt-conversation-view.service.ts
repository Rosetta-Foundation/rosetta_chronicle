import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import { ConversationView, ConversationViewInput } from '../types';
import type { IChatGptGraphStore } from '../repositories/chatgpt-graph-store.repository';
import { projectConversationView } from '../utils/chatgpt-conversation-view.utils';

/**
 * Read-only conversation-level projection over ChatGPT source graphs.
 *
 * Orchestrates the graph-store inventory and the deterministic util.
 * Does not write, invoke a model, call other services, or read vault
 * bytes. `ok` requires a present directory with no invalid siblings.
 */
export interface IChatGptConversationViewService {
  project(input: ConversationViewInput): Promise<ConversationView>;
}

/**
 * Service implementation of {@link IChatGptConversationViewService}.
 *
 * Uses `listResolved` so a corrupt graph file cannot disappear into a
 * silent `ok`. Missing directories are `not-found`.
 */
@injectable()
export class ChatGptConversationViewService
  implements IChatGptConversationViewService
{
  constructor(
    @inject(CHRONICLE_TOKENS.ChatGptGraphStore)
    private readonly _graphStore: IChatGptGraphStore,
  ) {}

  /** @inheritDoc */
  async project(input: ConversationViewInput): Promise<ConversationView> {
    const inventory = await this._graphStore.listResolved(input.graphsDir);
    return projectConversationView({
      graphs: inventory.records,
      inventory,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
    });
  }
}
