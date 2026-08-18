import 'reflect-metadata';
import { Container } from 'inversify';

const { CHRONICLE_TOKENS } = require('../tokens');
const { TransformationHandler } = require('../transformation.handler');

describe('TransformationHandler', () => {
  it('defaults createdAt and forwards the rest', async () => {
    const mockService = {
      transform: jest.fn().mockResolvedValue({ status: 'recorded' }),
      provenance: jest.fn(),
    };
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.TransformationService)
      .toConstantValue(mockService);
    container
      .bind(CHRONICLE_TOKENS.TransformationHandler)
      .to(TransformationHandler);
    const handler = container.get<{
      handle: (input: Record<string, unknown>) => Promise<unknown>;
    }>(CHRONICLE_TOKENS.TransformationHandler);

    await handler.handle({
      outputDir: '/out',
      executionsDir: '/exec',
      sourceGraphHash: 'a'.repeat(64),
      nodeIds: [],
      transformationType: 'human-note',
      transformationVersion: '1',
      createdBy: { type: 'human', name: 'fixture' },
      content: 'SYNTHETIC_DERIVED_NOTE',
    });
    expect(mockService.transform).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDir: '/out',
        executionsDir: '/exec',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    );
  });
});
