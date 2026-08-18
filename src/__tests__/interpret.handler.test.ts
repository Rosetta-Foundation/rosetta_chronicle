import 'reflect-metadata';
import { Container } from 'inversify';

const { CHRONICLE_TOKENS } = require('../tokens');
const { InterpretHandler } = require('../interpret.handler');

describe('InterpretHandler', () => {
  it('defaults createdAt, startedAt, and nonce then forwards', async () => {
    const mockService = {
      interpret: jest.fn().mockResolvedValue({ status: 'recorded' }),
    };
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.InterpretationService)
      .toConstantValue(mockService);
    container.bind(CHRONICLE_TOKENS.InterpretHandler).to(InterpretHandler);
    const handler = container.get<{
      handle: (input: Record<string, unknown>) => Promise<unknown>;
    }>(CHRONICLE_TOKENS.InterpretHandler);

    await handler.handle({
      exportPath: '/export',
      graphPath: '/graph.json',
      sourceGraphHash: 'a'.repeat(64),
      conversationId: 'conv-1',
      nodeIds: ['n1'],
      outputDir: '/out',
      executionsDir: '/exec',
      definitionsDir: '/defs',
      occurrencesDir: '/occ',
      provider: 'fixture',
      model: 'synthetic-model',
    });
    expect(mockService.interpret).toHaveBeenCalledWith(
      expect.objectContaining({
        exportPath: '/export',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        nonce: expect.stringMatching(/^[a-f0-9]{32}$/),
      }),
    );
  });
});
