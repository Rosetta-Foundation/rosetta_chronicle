import 'reflect-metadata';
import { Container } from 'inversify';

const { CHRONICLE_TOKENS } = require('../tokens');
const { ChatGptImportHandler } = require('../chatgpt-import.handler');

describe('ChatGptImportHandler', () => {
  it('defaults ingestedAt and forwards dryRun false', async () => {
    const mockService = {
      importGraph: jest.fn().mockResolvedValue({ status: 'imported' }),
    };
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.ChatGptImportService)
      .toConstantValue(mockService);
    container
      .bind(CHRONICLE_TOKENS.ChatGptImportHandler)
      .to(ChatGptImportHandler);
    const handler = container.get<{
      handle: (input: {
        exportPath: string;
        outputDir: string;
      }) => Promise<unknown>;
    }>(CHRONICLE_TOKENS.ChatGptImportHandler);

    await handler.handle({ exportPath: '/export', outputDir: '/graphs' });
    expect(mockService.importGraph).toHaveBeenCalledWith(
      '/export',
      '/graphs',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      false,
    );
  });

  it('forwards ingestedAt and dryRun', async () => {
    const mockService = { importGraph: jest.fn().mockResolvedValue({}) };
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.ChatGptImportService)
      .toConstantValue(mockService);
    container
      .bind(CHRONICLE_TOKENS.ChatGptImportHandler)
      .to(ChatGptImportHandler);
    const handler = container.get<{
      handle: (input: {
        exportPath: string;
        outputDir: string;
        ingestedAt: string;
        dryRun: boolean;
      }) => Promise<unknown>;
    }>(CHRONICLE_TOKENS.ChatGptImportHandler);

    await handler.handle({
      exportPath: '/export',
      outputDir: '/graphs',
      ingestedAt: '2026-08-17T21:00:00.000Z',
      dryRun: true,
    });
    expect(mockService.importGraph).toHaveBeenCalledWith(
      '/export',
      '/graphs',
      '2026-08-17T21:00:00.000Z',
      true,
    );
  });
});
