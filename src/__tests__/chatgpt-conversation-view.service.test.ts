import 'reflect-metadata';
import { Container } from 'inversify';
import { ConversationView, ConversationViewInput } from '../types';

const { CHRONICLE_TOKENS } = require('../tokens');
const {
  ChatGptConversationViewService,
} = require('../services/chatgpt-conversation-view.service');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const T1 = '2026-08-23T00:00:00.000Z';
const T2 = '2026-09-01T00:00:00.000Z';
const GENERATED = '2026-09-04T00:00:00.000Z';

const graph = (contentHash: string, importedAt: string, sourceId: string) => ({
  archive: {
    contentHash,
    kind: 'directory',
    importedAt,
    shardNames: [],
    sidecarFiles: [],
  },
  conversations: [
    {
      sourceId,
      currentNodeId: 'n1',
      archived: false,
      nodes: [
        {
          id: 'n1',
          parentId: null,
          sourceChildIds: [],
          reconstructedChildIds: [],
          hasMessage: true,
          attachments: [],
        },
      ],
    },
  ],
  unsupported: [],
});

describe('ChatGptConversationViewService', () => {
  let listResolved: jest.Mock;
  let service: {
    project: (input: ConversationViewInput) => Promise<ConversationView>;
  };

  beforeEach(() => {
    listResolved = jest.fn();
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.ChatGptGraphStore)
      .toConstantValue({ listResolved });
    container
      .bind(CHRONICLE_TOKENS.ChatGptConversationViewService)
      .to(ChatGptConversationViewService);
    service = container.get(CHRONICLE_TOKENS.ChatGptConversationViewService);
  });

  it('projects an inventory from the graph store without writing', async () => {
    listResolved.mockResolvedValue({
      present: true,
      records: [
        graph(HASH_A, T1, 'c1'),
        graph(HASH_B, T2, 'c1'),
      ],
      failures: [],
    });
    const view = await service.project({
      graphsDir: '/tmp/graphs',
      generatedAt: GENERATED,
    });
    expect(listResolved).toHaveBeenCalledWith('/tmp/graphs');
    expect(view.status).toBe('ok');
    expect(view.archiveCount).toBe(2);
    expect(view.conversations[0].changeKind).toBe('unchanged');
    expect(listResolved.mock.calls).toHaveLength(1);
  });

  it('returns not-found when the store directory is absent', async () => {
    listResolved.mockResolvedValue({
      present: false,
      records: [],
      failures: [],
    });
    const view = await service.project({
      graphsDir: '/tmp/missing',
      generatedAt: GENERATED,
    });
    expect(view.status).toBe('not-found');
    expect(view.conversations).toEqual([]);
  });
});
