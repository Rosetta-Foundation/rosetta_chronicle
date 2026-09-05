import {
  ChatGptSourceConversation,
  ChatGptSourceGraph,
  ConversationArchiveAppearance,
  ConversationChangeKind,
  ConversationView,
  ConversationViewRow,
  ConversationViewStatus,
  StoreInventory,
} from '../types';

export const CONVERSATION_CHANGE_KINDS: readonly ConversationChangeKind[] = [
  'new-in-latest',
  'absent-from-latest',
  'grew',
  'shrank',
  'tip-moved',
  'unchanged',
] as const;

export const emptyChangeKinds = (): Record<ConversationChangeKind, number> => ({
  'new-in-latest': 0,
  'absent-from-latest': 0,
  grew: 0,
  shrank: 0,
  'tip-moved': 0,
  unchanged: 0,
});

/**
 * Default CLI renderer: keep aggregates, drop conversation ids.
 * The service view still holds exact sourceIds.
 */
export const redactConversationView = (
  view: ConversationView,
): ConversationView => ({
  ...view,
  conversations: [],
});

const compareImportedAt = (
  a: ChatGptSourceGraph,
  b: ChatGptSourceGraph,
): number => {
  const byTime = a.archive.importedAt.localeCompare(b.archive.importedAt);
  if (byTime !== 0) return byTime;
  return a.archive.contentHash.localeCompare(b.archive.contentHash);
};

const appearanceOf = (
  graph: ChatGptSourceGraph,
  conversation: ChatGptSourceConversation,
): ConversationArchiveAppearance => ({
  contentHash: graph.archive.contentHash,
  importedAt: graph.archive.importedAt,
  nodeCount: conversation.nodes.length,
  messageNodeCount: conversation.nodes.filter((node) => node.hasMessage)
    .length,
  ...(conversation.currentNodeId
    ? { currentNodeId: conversation.currentNodeId }
    : {}),
  archived: conversation.archived,
  ...(conversation.updateTime
    ? { updateTime: conversation.updateTime }
    : {}),
});

const attachmentCounts = (
  conversation: ChatGptSourceConversation,
): { attachmentRefCount: number; missingAttachmentCount: number } => {
  let attachmentRefCount = 0;
  let missingAttachmentCount = 0;
  for (const node of conversation.nodes) {
    for (const attachment of node.attachments) {
      attachmentRefCount += 1;
      if (!attachment.presentInArchive) missingAttachmentCount += 1;
    }
  }
  return { attachmentRefCount, missingAttachmentCount };
};

const classifyChange = (
  first: ConversationArchiveAppearance,
  latest: ConversationArchiveAppearance,
  inLatestArchive: boolean,
  totalGraphs: number,
): ConversationChangeKind => {
  if (!inLatestArchive) return 'absent-from-latest';
  if (first.contentHash === latest.contentHash && totalGraphs > 1) {
    return 'new-in-latest';
  }
  if (latest.nodeCount > first.nodeCount) return 'grew';
  if (latest.nodeCount < first.nodeCount) return 'shrank';
  if (latest.currentNodeId !== first.currentNodeId) return 'tip-moved';
  return 'unchanged';
};

const emptyView = (
  status: ConversationViewStatus,
  generatedAt: string,
  failures: ConversationView['failures'],
): ConversationView => ({
  status,
  generatedAt,
  archiveCount: 0,
  conversationCount: 0,
  changeKinds: emptyChangeKinds(),
  conversations: [],
  failures,
});

/**
 * Deterministic conversation-level projection over source-graph
 * snapshots. Topology and clocks only. Snapshots are not merged.
 */
export const projectConversationView = (input: {
  graphs: ChatGptSourceGraph[];
  inventory: StoreInventory<ChatGptSourceGraph>;
  generatedAt: string;
}): ConversationView => {
  if (!input.inventory.present) {
    return emptyView('not-found', input.generatedAt, input.inventory.failures);
  }
  if (input.graphs.length === 0 && input.inventory.failures.length > 0) {
    return emptyView('invalid', input.generatedAt, input.inventory.failures);
  }

  const graphs = [...input.graphs].sort(compareImportedAt);
  const latestHash = graphs[graphs.length - 1]?.archive.contentHash;
  const bySource = new Map<
    string,
    {
      archives: ConversationArchiveAppearance[];
      latestConversation: ChatGptSourceConversation;
    }
  >();

  for (const graph of graphs) {
    for (const conversation of graph.conversations) {
      const appearance = appearanceOf(graph, conversation);
      const existing = bySource.get(conversation.sourceId);
      if (!existing) {
        bySource.set(conversation.sourceId, {
          archives: [appearance],
          latestConversation: conversation,
        });
        continue;
      }
      existing.archives.push(appearance);
      existing.latestConversation = conversation;
    }
  }

  const changeKinds = emptyChangeKinds();
  const conversations: ConversationViewRow[] = [...bySource.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sourceId, group]) => {
      const first = group.archives[0];
      const latest = group.archives[group.archives.length - 1];
      const inLatestArchive = group.archives.some(
        (row) => row.contentHash === latestHash,
      );
      const changeKind = classifyChange(
        first,
        latest,
        inLatestArchive,
        graphs.length,
      );
      changeKinds[changeKind] += 1;
      return {
        sourceId,
        archives: group.archives,
        firstSeenArchive: first.contentHash,
        latestArchive: latest.contentHash,
        nodeDelta: latest.nodeCount - first.nodeCount,
        ...attachmentCounts(group.latestConversation),
        changeKind,
      };
    });

  return {
    status: input.inventory.failures.length > 0 ? 'partial' : 'ok',
    generatedAt: input.generatedAt,
    archiveCount: graphs.length,
    conversationCount: conversations.length,
    changeKinds,
    conversations,
    failures: input.inventory.failures,
  };
};
