import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from './tokens';
import { ContextPacket, ContextPacketInput } from './types';
import type { IContextPacketService } from './services/context-packet.service';

/**
 * Entry point for a bounded lexical context packet.
 *
 * Parses nothing beyond dispatch. Does not write, index, or call a
 * model. Authorization and selection live in the service.
 */
export interface IContextPacketHandler {
  handle(input: ContextPacketInput): Promise<ContextPacket>;
}

/**
 * Root handler implementation of {@link IContextPacketHandler}.
 */
@injectable()
export class ContextPacketHandler implements IContextPacketHandler {
  constructor(
    @inject(CHRONICLE_TOKENS.ContextPacketService)
    private readonly _packets: IContextPacketService,
  ) {}

  /** @inheritDoc */
  async handle(input: ContextPacketInput): Promise<ContextPacket> {
    return this._packets.assemble(input);
  }
}
