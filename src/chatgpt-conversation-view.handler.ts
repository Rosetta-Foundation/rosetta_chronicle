import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from './tokens';
import { ConversationView, ConversationViewInput } from './types';
import type { IChatGptConversationViewService } from './services/chatgpt-conversation-view.service';

/**
 * Entry point for the read-only ChatGPT conversation-level view.
 *
 * Stamps `generatedAt` when omitted, then dispatches. Holds no
 * projection logic and does not write, invoke a model, or emit
 * Activity / Daily Chronicle.
 */
export interface IChatGptConversationViewHandler {
  handle(input: ConversationViewInput): Promise<ConversationView>;
}

/**
 * Root handler implementation of {@link IChatGptConversationViewHandler}.
 *
 * Rebuildable stdout projection over existing source-graph snapshots.
 * Snapshots stay unmerged. Not canonical evidence.
 */
@injectable()
export class ChatGptConversationViewHandler
  implements IChatGptConversationViewHandler
{
  constructor(
    @inject(CHRONICLE_TOKENS.ChatGptConversationViewService)
    private readonly _conversationView: IChatGptConversationViewService,
  ) {}

  /** @inheritDoc */
  async handle(input: ConversationViewInput): Promise<ConversationView> {
    return this._conversationView.project({
      ...input,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
    });
  }
}
