import 'reflect-metadata';
import { Container } from 'inversify';

const { CHRONICLE_TOKENS } = require('../tokens');
const { EvaluateHandler } = require('../evaluate.handler');

describe('EvaluateHandler', () => {
  it('defaults evaluatedAt and recordedAt and forwards the rest', async () => {
    const mockService = {
      evaluate: jest.fn().mockResolvedValue({ status: 'recorded' }),
    };
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.EvaluationService)
      .toConstantValue(mockService);
    container.bind(CHRONICLE_TOKENS.EvaluateHandler).to(EvaluateHandler);
    const handler = container.get<{
      handle: (input: Record<string, unknown>) => Promise<unknown>;
    }>(CHRONICLE_TOKENS.EvaluateHandler);

    await handler.handle({
      outputDir: '/derived',
      evaluationsDir: '/evaluations',
      evaluatedRecordId: 'a'.repeat(64),
      evaluatorName: 'operator',
      evidenceSupport: 'supported',
    });
    expect(mockService.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDir: '/derived',
        evaluatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        recordedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    );
  });
});
