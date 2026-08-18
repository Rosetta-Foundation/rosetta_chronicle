import 'reflect-metadata';
import { Container } from 'inversify';

const { CHRONICLE_TOKENS } = require('../tokens');
const { ProvenanceHandler } = require('../provenance.handler');

describe('ProvenanceHandler', () => {
  it('forwards traverse input to the service', async () => {
    const mockService = {
      traverse: jest.fn().mockResolvedValue({ status: 'ok' }),
    };
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.ProvenanceService)
      .toConstantValue(mockService);
    container.bind(CHRONICLE_TOKENS.ProvenanceHandler).to(ProvenanceHandler);
    const handler = container.get<{
      handle: (input: Record<string, unknown>) => Promise<unknown>;
    }>(CHRONICLE_TOKENS.ProvenanceHandler);
    const input = {
      start: { kind: 'derived-record', id: 'a'.repeat(64) },
      direction: 'backward',
      graphsDir: '/g',
      outputDir: '/o',
      executionsDir: '/e',
      definitionsDir: '/d',
    };
    await handler.handle(input);
    expect(mockService.traverse).toHaveBeenCalledWith(input);
  });
});
