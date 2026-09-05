import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from './tokens';
import { ConversationLocateInput, ConversationLocateView } from './types';
import type { IChatGptConversationLocateService } from './services/chatgpt-conversation-locate.service';

/**
 * Entry point for locating one ChatGPT conversation by vendor id.
 *
 * Stamps `generatedAt` when omitted, then dispatches. Holds no
 * projection logic. Does not write or emit Activity.
 */
export interface IChatGptConversationLocateHandler {
  handle(input: ConversationLocateInput): Promise<ConversationLocateView>;
}

/**
 * Root handler implementation of {@link IChatGptConversationLocateHandler}.
 *
 * Rebuildable lookup over existing snapshots. Not canonical evidence.
 */
@injectable()
export class ChatGptConversationLocateHandler
  implements IChatGptConversationLocateHandler
{
  constructor(
    @inject(CHRONICLE_TOKENS.ChatGptConversationLocateService)
    private readonly _locate: IChatGptConversationLocateService,
  ) {}

  /** @inheritDoc */
  async handle(
    input: ConversationLocateInput,
  ): Promise<ConversationLocateView> {
    return this._locate.locate({
      ...input,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
    });
  }
}
