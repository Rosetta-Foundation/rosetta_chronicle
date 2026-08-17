import 'reflect-metadata';
import { Container } from 'inversify';

const { CHRONICLE_TOKENS } = require('../tokens');
const {
  ChatGptInventoryHandler,
} = require('../chatgpt-inventory.handler');

describe('ChatGptInventoryHandler', () => {
  it('defaults ingestedAt and does not persist', async () => {
    const mockService = {
      inventory: jest.fn().mockResolvedValue({
        status: 'ok',
        sourcePath: '/export',
        ingestedAt: 'from-service',
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
      }),
    };
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.ChatGptInventoryService)
      .toConstantValue(mockService);
    container
      .bind(CHRONICLE_TOKENS.ChatGptInventoryHandler)
      .to(ChatGptInventoryHandler);
    const handler = container.get<{
      handle: (input: { exportPath: string }) => Promise<unknown>;
    }>(CHRONICLE_TOKENS.ChatGptInventoryHandler);

    await handler.handle({ exportPath: '/export' });
    expect(mockService.inventory).toHaveBeenCalledWith(
      '/export',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
  });

  it('forwards an explicit ingestedAt', async () => {
    const mockService = { inventory: jest.fn().mockResolvedValue({}) };
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.ChatGptInventoryService)
      .toConstantValue(mockService);
    container
      .bind(CHRONICLE_TOKENS.ChatGptInventoryHandler)
      .to(ChatGptInventoryHandler);
    const handler = container.get<{
      handle: (input: {
        exportPath: string;
        ingestedAt: string;
      }) => Promise<unknown>;
    }>(CHRONICLE_TOKENS.ChatGptInventoryHandler);

    await handler.handle({
      exportPath: '/export',
      ingestedAt: '2026-08-17T21:00:00.000Z',
    });
    expect(mockService.inventory).toHaveBeenCalledWith(
      '/export',
      '2026-08-17T21:00:00.000Z',
    );
  });
});
