import {
  ChatGptSourceConversation,
  ChatGptSourceGraph,
  ChatGptSourceNode,
  StoreInventory,
} from '../types';
import {
  projectConversationView,
  redactConversationView,
} from '../utils/chatgpt-conversation-view.utils';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const T1 = '2026-08-23T00:00:00.000Z';
const T2 = '2026-09-01T00:00:00.000Z';
const GENERATED = '2026-09-04T00:00:00.000Z';

const node = (
  id: string,
  extras: Partial<ChatGptSourceNode> = {},
): ChatGptSourceNode => ({
  id,
  parentId: null,
  sourceChildIds: [],
  reconstructedChildIds: [],
  hasMessage: true,
  attachments: [],
  ...extras,
});

const conversation = (
  sourceId: string,
  nodes: ChatGptSourceNode[],
  extras: Partial<ChatGptSourceConversation> = {},
): ChatGptSourceConversation => ({
  sourceId,
  currentNodeId: nodes[nodes.length - 1]?.id,
  archived: false,
  nodes,
  ...extras,
});

const graph = (
  contentHash: string,
  importedAt: string,
  conversations: ChatGptSourceConversation[],
): ChatGptSourceGraph => ({
  archive: {
    contentHash,
    kind: 'directory',
    importedAt,
    shardNames: ['conversations-000.json'],
    sidecarFiles: [],
  },
  conversations,
  unsupported: [],
});

const inventory = (
  records: ChatGptSourceGraph[],
  extras: Partial<StoreInventory<ChatGptSourceGraph>> = {},
): StoreInventory<ChatGptSourceGraph> => ({
  present: true,
  records,
  failures: [],
  ...extras,
});

const project = (
  graphs: ChatGptSourceGraph[],
  extras: Partial<StoreInventory<ChatGptSourceGraph>> = {},
) =>
  projectConversationView({
    graphs,
    inventory: inventory(graphs, extras),
    generatedAt: GENERATED,
  });

describe('projectConversationView', () => {
  it('classifies every mechanical changeKind across two snapshots', () => {
    const first = graph(HASH_A, T1, [
      conversation('grew', [node('n1')]),
      conversation('shrank', [node('s1'), node('s2')]),
      conversation('tip', [node('t1')], { currentNodeId: 't1' }),
      conversation('same', [node('u1')]),
      conversation('gone', [node('g1')]),
    ]);
    const second = graph(HASH_B, T2, [
      conversation('grew', [node('n1'), node('n2')]),
      conversation('shrank', [node('s1')]),
      conversation('tip', [node('t1')], { currentNodeId: 't2' }),
      conversation('same', [node('u1')]),
      conversation('fresh', [node('f1')]),
    ]);
    const view = project([first, second]);
    expect(view.status).toBe('ok');
    expect(view.archiveCount).toBe(2);
    expect(view.conversationCount).toBe(6);
    const byId = Object.fromEntries(
      view.conversations.map((row) => [row.sourceId, row]),
    );
    expect(byId.grew.changeKind).toBe('grew');
    expect(byId.grew.nodeDelta).toBe(1);
    expect(byId.shrank.changeKind).toBe('shrank');
    expect(byId.shrank.nodeDelta).toBe(-1);
    expect(byId.tip.changeKind).toBe('tip-moved');
    expect(byId.same.changeKind).toBe('unchanged');
    expect(byId.gone.changeKind).toBe('absent-from-latest');
    expect(byId.fresh.changeKind).toBe('new-in-latest');
    expect(view.changeKinds).toEqual({
      'new-in-latest': 1,
      'absent-from-latest': 1,
      grew: 1,
      shrank: 1,
      'tip-moved': 1,
      unchanged: 1,
    });
  });

  it('prefers grew over tip-moved when both apply', () => {
    const first = graph(HASH_A, T1, [
      conversation('both', [node('n1')], { currentNodeId: 'n1' }),
    ]);
    const second = graph(HASH_B, T2, [
      conversation('both', [node('n1'), node('n2')], { currentNodeId: 'n2' }),
    ]);
    expect(project([first, second]).conversations[0].changeKind).toBe('grew');
  });

  it('treats a single snapshot as unchanged, not new-in-latest', () => {
    const only = graph(HASH_A, T1, [conversation('solo', [node('n1')])]);
    const view = project([only]);
    expect(view.conversations[0].changeKind).toBe('unchanged');
    expect(view.changeKinds['new-in-latest']).toBe(0);
  });

  it('counts attachments from the latest snapshot only', () => {
    const first = graph(HASH_A, T1, [
      conversation('att', [
        node('n1', {
          attachments: [{ presentInArchive: false }, { presentInArchive: true }],
        }),
      ]),
    ]);
    const second = graph(HASH_B, T2, [
      conversation('att', [
        node('n1', {
          attachments: [
            { presentInArchive: true },
            { presentInArchive: false },
            { presentInArchive: false },
          ],
        }),
      ]),
    ]);
    const row = project([first, second]).conversations[0];
    expect(row.attachmentRefCount).toBe(3);
    expect(row.missingAttachmentCount).toBe(2);
  });

  it('never materializes title or message text fields', () => {
    const view = project([
      graph(HASH_A, T1, [conversation('c1', [node('n1')])]),
    ]);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/"title"/);
    expect(serialized).not.toMatch(/"text"/);
    expect(serialized).not.toMatch(/"parts"/);
    expect(view.conversations[0]).not.toHaveProperty('title');
  });

  it('returns not-found when the graphs directory is absent', () => {
    const view = projectConversationView({
      graphs: [],
      inventory: { present: false, records: [], failures: [] },
      generatedAt: GENERATED,
    });
    expect(view.status).toBe('not-found');
    expect(view.conversationCount).toBe(0);
  });

  it('returns invalid when only corrupt siblings are present', () => {
    const view = projectConversationView({
      graphs: [],
      inventory: {
        present: true,
        records: [],
        failures: [{ filename: `${HASH_C}.json`, status: 'invalid' }],
      },
      generatedAt: GENERATED,
    });
    expect(view.status).toBe('invalid');
  });

  it('returns partial when valid graphs sit beside failures', () => {
    const only = graph(HASH_A, T1, [conversation('solo', [node('n1')])]);
    const view = project([only], {
      failures: [{ filename: `${HASH_C}.json`, status: 'invalid' }],
    });
    expect(view.status).toBe('partial');
    expect(view.archiveCount).toBe(1);
  });

  it('redacts conversation ids for default stdout', () => {
    const view = project([
      graph(HASH_A, T1, [conversation('secret-id', [node('n1')])]),
    ]);
    const redacted = redactConversationView(view);
    expect(redacted.conversationCount).toBe(1);
    expect(redacted.conversations).toEqual([]);
    expect(JSON.stringify(redacted)).not.toContain('secret-id');
  });
});
