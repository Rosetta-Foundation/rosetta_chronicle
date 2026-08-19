import 'reflect-metadata';
import { Container } from 'inversify';

const { CHRONICLE_TOKENS } = require('../tokens');
const {
  CurrentUnderstandingHandler,
} = require('../current-understanding.handler');

describe('CurrentUnderstandingHandler', () => {
  it('defaults asOf and generatedAt and forwards the rest', async () => {
    const mockService = {
      project: jest.fn().mockResolvedValue({ status: 'ok' }),
    };
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.CurrentUnderstandingService)
      .toConstantValue(mockService);
    container
      .bind(CHRONICLE_TOKENS.CurrentUnderstandingHandler)
      .to(CurrentUnderstandingHandler);
    const handler = container.get<{
      handle: (input: Record<string, unknown>) => Promise<unknown>;
    }>(CHRONICLE_TOKENS.CurrentUnderstandingHandler);

    await handler.handle({
      outputDir: '/derived',
      evaluationsDir: '/evaluations',
      evaluatorName: 'operator',
    });
    expect(mockService.project).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDir: '/derived',
        evaluatorName: 'operator',
        asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        generatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    );
  });
});
