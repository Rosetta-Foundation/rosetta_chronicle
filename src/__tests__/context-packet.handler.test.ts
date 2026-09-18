import 'reflect-metadata';
import { Container } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import { ContextPacketHandler } from '../context-packet.handler';
import { ContextPacket } from '../types';

describe('ContextPacketHandler', () => {
  it('dispatches to the service without transforming the request', async () => {
    const assemble = jest.fn(async (): Promise<ContextPacket> => {
      return { status: 'ok' } as ContextPacket;
    });
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.ContextPacketService)
      .toConstantValue({ assemble });
    container
      .bind(CHRONICLE_TOKENS.ContextPacketHandler)
      .to(ContextPacketHandler);
    const handler = container.get<ContextPacketHandler>(
      CHRONICLE_TOKENS.ContextPacketHandler,
    );
    const input = {
      dataDir: '/tmp/fixture',
      scopes: ['s'],
      selectors: ['winding path'],
    };
    const result = await handler.handle(input);
    expect(assemble).toHaveBeenCalledWith(input);
    expect(result.status).toBe('ok');
  });
});
