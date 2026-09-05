import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import { ConversationLocateInput, ConversationLocateView } from '../types';
import type { IChatGptGraphStore } from '../repositories/chatgpt-graph-store.repository';
import {
  locateConversation,
  projectConversationView,
} from '../utils/chatgpt-conversation-view.utils';

/**
 * Read-only lookup of one vendor conversation across source-graph
 * snapshots. Does not write, invoke a model, or read vault bytes.
 */
export interface IChatGptConversationLocateService {
  locate(input: ConversationLocateInput): Promise<ConversationLocateView>;
}

/**
 * Service implementation of {@link IChatGptConversationLocateService}.
 *
 * Reuses the conversation-view projection so locate and view stay
 * consistent. Graph file hashes are not vault object hashes.
 */
@injectable()
export class ChatGptConversationLocateService
  implements IChatGptConversationLocateService
{
  constructor(
    @inject(CHRONICLE_TOKENS.ChatGptGraphStore)
    private readonly _graphStore: IChatGptGraphStore,
  ) {}

  /** @inheritDoc */
  async locate(
    input: ConversationLocateInput,
  ): Promise<ConversationLocateView> {
    const inventory = await this._graphStore.listResolved(input.graphsDir);
    const view = projectConversationView({
      graphs: inventory.records,
      inventory,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
    });
    return locateConversation(view, input.sourceId, input.graphsDir);
  }
}
