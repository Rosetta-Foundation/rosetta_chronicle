import 'reflect-metadata';
import { Container } from 'inversify';

const { CHRONICLE_TOKENS } = require('../tokens');
const { DerivedRecordHandler } = require('../derived-record.handler');

describe('DerivedRecordHandler', () => {
  it('defaults createdAt and forwards the rest', async () => {
    const mockService = {
      record: jest.fn().mockResolvedValue({ status: 'recorded' }),
    };
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.DerivedRecordService)
      .toConstantValue(mockService);
    container
      .bind(CHRONICLE_TOKENS.DerivedRecordHandler)
      .to(DerivedRecordHandler);
    const handler = container.get<{
      handle: (input: Record<string, unknown>) => Promise<unknown>;
    }>(CHRONICLE_TOKENS.DerivedRecordHandler);

    await handler.handle({
      outputDir: '/out',
      sourceGraphHash: 'a'.repeat(64),
      nodeIds: [],
      transformationType: 'human-note',
      createdBy: { type: 'human', name: 'fixture' },
      content: 'SYNTHETIC_DERIVED_NOTE',
    });
    expect(mockService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDir: '/out',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    );
  });
});
