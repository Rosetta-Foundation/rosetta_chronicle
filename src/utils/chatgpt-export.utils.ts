import { createHash } from 'crypto';
import {
  ChatGptConversationInventory,
  ChatGptExportInventory,
  ChatGptPartShape,
  ChatGptRawConversation,
  ChatGptRawExport,
  ChatGptRawNode,
  ChatGptSourceConversation,
  ChatGptSourceGraph,
  ChatGptSourceNode,
  ChatGptUnsupportedRecord,
} from '../types';

/** Content types observed in the inventoried export plus common ChatGPT types. */
export const KNOWN_CONTENT_TYPES = new Set([
  'text',
  'multimodal_text',
  'reasoning_recap',
  'thoughts',
  'code',
  'execution_output',
  'tether_browsing_display',
  'system_error',
]);

const PRIVACY_SIDECARS = new Set([
  'user.json',
  'user_settings.json',
  'ads.json',
  'message_feedback.json',
]);

/** SHA-256 hex digest of the given bytes. */
export const sha256Hex = (bytes: Buffer | string): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Convert a ChatGPT unix timestamp (seconds, possibly fractional) to ISO-8601. */
export const unixSecondsToIso = (value: number): string =>
  new Date(value * 1000).toISOString();

/** Classify a content.parts entry without retaining its payload. */
export const partShape = (part: unknown): ChatGptPartShape => {
  if (part === null) return { kind: 'null' };
  if (typeof part === 'string') return { kind: 'string' };
  if (typeof part === 'object') {
    const rec = part as Record<string, unknown>;
    const objectType =
      typeof rec['content_type'] === 'string'
        ? rec['content_type']
        : typeof rec['type'] === 'string'
          ? rec['type']
          : undefined;
    return objectType ? { kind: 'object', objectType } : { kind: 'object' };
  }
  return { kind: 'other' };
};

/**
 * Rebuild child ids from parent links. This export's nodes omit `children`;
 * topology is parent-linked. Source children, when present, are unioned in.
 *
 * Inventory uses this union to flag `branched`. The durable source graph
 * stores the two topologies separately — see {@link childIdsFromParents}.
 */
export const reconstructChildIds = (
  nodes: ChatGptRawNode[],
): Map<string, string[]> => {
  const byParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.id) continue;
    for (const child of node.sourceChildIds) {
      const list = byParent.get(node.id) ?? [];
      if (!list.includes(child)) list.push(child);
      byParent.set(node.id, list);
    }
    if (node.parentId) {
      const list = byParent.get(node.parentId) ?? [];
      if (!list.includes(node.id)) list.push(node.id);
      byParent.set(node.parentId, list);
    }
  }
  return byParent;
};

/**
 * Children inferred only from parent pointers. Does not union vendor
 * `children`. The source graph persists this beside `sourceChildIds`.
 */
export const childIdsFromParents = (
  nodes: ChatGptRawNode[],
): Map<string, string[]> => {
  const byParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.id || !node.parentId) continue;
    const list = byParent.get(node.parentId) ?? [];
    if (!list.includes(node.id)) list.push(node.id);
    byParent.set(node.parentId, list);
  }
  return byParent;
};

/**
 * Structural gaps on a stripped export. Shared by inventory and the source
 * graph so unsupported records stay aligned. Does not drop nodes.
 */
export const collectUnsupported = (
  raw: ChatGptRawExport,
): ChatGptUnsupportedRecord[] => {
  const unsupported: ChatGptUnsupportedRecord[] = [...raw.unsupported];
  for (const conv of raw.conversations) {
    if (conv.malformedReasons.length > 0 || !conv.sourceId) {
      for (const reason of conv.malformedReasons) {
        unsupported.push({ conversationId: conv.sourceId, reason });
      }
      if (!conv.sourceId) {
        unsupported.push({ reason: 'conversation-missing-id' });
      }
    }
    for (const node of conv.nodes) {
      for (const reason of node.malformedReasons) {
        unsupported.push({
          conversationId: conv.sourceId,
          nodeId: node.id,
          reason,
        });
      }
      if (!node.hasMessage) continue;
      if (node.contentType && !KNOWN_CONTENT_TYPES.has(node.contentType)) {
        unsupported.push({
          conversationId: conv.sourceId,
          nodeId: node.id,
          reason: `unknown-content-type:${node.contentType}`,
        });
      }
      for (const ref of node.attachmentRefs) {
        const id = ref.id;
        const present = id
          ? attachmentPresentInArchive(id, raw.archiveFiles)
          : false;
        if (!present) {
          unsupported.push({
            conversationId: conv.sourceId,
            nodeId: node.id,
            reason: 'attachment-missing-from-archive',
          });
        }
      }
    }
  }
  return unsupported;
};

const bump = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/**
 * Whether a `metadata.attachments[].id` has a corresponding archive file.
 *
 * In inventoried OpenAI exports the authoritative mapping is:
 * `attachment.id` → `{id}.dat` in the zip/directory listing. Some ids have
 * no blob; those are missing, not a mapping miss.
 *
 * `conversation_asset_file_names.json` maps that `.dat` name to a display
 * filename — it is not the presence index. `library_files.json` is a
 * separate catalog (`library_file_id` / nested library `id`); a catalog
 * row does not mean the blob is in the archive.
 */
export const attachmentPresentInArchive = (
  attachmentId: string,
  archiveFiles: string[],
): boolean => {
  const base = attachmentId.split('/').pop() ?? attachmentId;
  const candidates = new Set([attachmentId, base, `${base}.dat`]);
  return archiveFiles.some((f) => {
    const fileBase = f.split('/').pop() ?? f;
    return candidates.has(f) || candidates.has(fileBase);
  });
};

/**
 * Derive the public inventory from a stripped export. Pure: no I/O, no
 * Chronicle writes, no source text.
 */
export const buildInventory = (
  raw: ChatGptRawExport,
  sourcePath: string,
  ingestedAt: string,
): ChatGptExportInventory => {
  const unsupported = collectUnsupported(raw);
  const roleCounts: Record<string, number> = {};
  const contentTypeSet = new Set<string>();
  const conversations: ChatGptConversationInventory[] = [];
  let nodeCount = 0;
  let messageNodeCount = 0;
  let attachmentRefCount = 0;
  let attachmentsPresent = 0;
  let attachmentsMissing = 0;
  let conversationsWithBranches = 0;
  const eventTimes: number[] = [];

  for (const conv of raw.conversations) {
    const childrenByParent = reconstructChildIds(conv.nodes);
    let branched = false;
    for (const kids of childrenByParent.values()) {
      if (kids.length > 1) branched = true;
    }

    const convRoles: Record<string, number> = {};
    const convTypes = new Set<string>();
    let convMessages = 0;
    let convNull = 0;
    let convAttachments = 0;
    let missingTs = false;

    if (typeof conv.createTime === 'number') eventTimes.push(conv.createTime);
    if (typeof conv.updateTime === 'number') eventTimes.push(conv.updateTime);

    for (const node of conv.nodes) {
      nodeCount++;
      if (!node.hasMessage) {
        convNull++;
        continue;
      }
      convMessages++;
      messageNodeCount++;
      const role = node.role ?? 'unknown';
      bump(convRoles, role);
      bump(roleCounts, role);
      if (node.contentType) {
        convTypes.add(node.contentType);
        contentTypeSet.add(node.contentType);
      }
      if (node.createTime == null) missingTs = true;
      else eventTimes.push(node.createTime);
      if (typeof node.updateTime === 'number') eventTimes.push(node.updateTime);

      for (const ref of node.attachmentRefs) {
        convAttachments++;
        attachmentRefCount++;
        const id = ref.id;
        const present = id
          ? attachmentPresentInArchive(id, raw.archiveFiles)
          : false;
        if (present) attachmentsPresent++;
        else attachmentsMissing++;
      }
    }

    if (branched) conversationsWithBranches++;

    if (conv.sourceId) {
      conversations.push({
        sourceId: conv.sourceId,
        nodeCount: conv.nodes.length,
        messageNodeCount: convMessages,
        nullMessageNodeCount: convNull,
        roleCounts: convRoles,
        contentTypes: [...convTypes].sort(),
        attachmentRefCount: convAttachments,
        branched,
        ...(conv.currentNodeId ? { currentNodeId: conv.currentNodeId } : {}),
        ...(typeof conv.createTime === 'number'
          ? { createTime: unixSecondsToIso(conv.createTime) }
          : {}),
        ...(typeof conv.updateTime === 'number'
          ? { updateTime: unixSecondsToIso(conv.updateTime) }
          : {}),
        hasMissingMessageTimestamps: missingTs,
        archived: conv.archived,
      });
    }
  }

  const privacySignals = raw.sidecarFiles
    .filter((f) => PRIVACY_SIDECARS.has(f.split('/').pop() ?? f))
    .sort();

  const eventTimeRange =
    eventTimes.length > 0
      ? {
          start: unixSecondsToIso(Math.min(...eventTimes)),
          end: unixSecondsToIso(Math.max(...eventTimes)),
        }
      : undefined;

  return {
    status: 'ok',
    sourceKind: raw.kind,
    sourcePath,
    contentHash: raw.contentHash,
    ingestedAt,
    ...(eventTimeRange ? { eventTimeRange } : {}),
    conversationCount: conversations.length,
    nodeCount,
    messageNodeCount,
    roleCounts,
    contentTypes: [...contentTypeSet].sort(),
    attachmentRefCount,
    attachmentsPresent,
    attachmentsMissing,
    conversationsWithBranches,
    shardCount: raw.shardNames.length,
    sidecarFiles: [...raw.sidecarFiles].sort(),
    privacySignals,
    unsupported,
    conversations,
  };
};

/**
 * Normalize a stripped export into a durable conversation graph. Topology
 * and type only — no titles, parts, or attachment bytes. Source children
 * and parent-reconstructed children are stored separately.
 */
export const buildSourceGraph = (
  raw: ChatGptRawExport,
  importedAt: string,
): ChatGptSourceGraph => {
  const conversations: ChatGptSourceConversation[] = [];
  for (const conv of raw.conversations) {
    if (!conv.sourceId) continue;
    const reconstructed = childIdsFromParents(conv.nodes);
    const nodes: ChatGptSourceNode[] = [];
    for (const node of conv.nodes) {
      if (!node.id) continue;
      nodes.push({
        id: node.id,
        parentId: node.parentId,
        sourceChildIds: [...node.sourceChildIds],
        reconstructedChildIds: reconstructed.get(node.id) ?? [],
        hasMessage: node.hasMessage,
        ...(node.role ? { role: node.role } : {}),
        ...(node.contentType ? { contentType: node.contentType } : {}),
        ...(typeof node.createTime === 'number'
          ? { createTime: unixSecondsToIso(node.createTime) }
          : {}),
        ...(typeof node.updateTime === 'number'
          ? { updateTime: unixSecondsToIso(node.updateTime) }
          : {}),
        attachments: node.attachmentRefs.map((ref) => ({
          ...ref,
          presentInArchive: ref.id
            ? attachmentPresentInArchive(ref.id, raw.archiveFiles)
            : false,
        })),
      });
    }
    conversations.push({
      sourceId: conv.sourceId,
      ...(conv.currentNodeId ? { currentNodeId: conv.currentNodeId } : {}),
      ...(typeof conv.createTime === 'number'
        ? { createTime: unixSecondsToIso(conv.createTime) }
        : {}),
      ...(typeof conv.updateTime === 'number'
        ? { updateTime: unixSecondsToIso(conv.updateTime) }
        : {}),
      archived: conv.archived,
      nodes,
    });
  }
  return {
    archive: {
      contentHash: raw.contentHash,
      kind: raw.kind,
      importedAt,
      shardNames: [...raw.shardNames],
      sidecarFiles: [...raw.sidecarFiles].sort(),
    },
    conversations,
    unsupported: collectUnsupported(raw),
  };
};

/** True when `value` looks like a ChatGPT conversation mapping object. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Strip one mapping node to structural fields. Discards message parts,
 * titles, and any other source text.
 */
export const stripNode = (value: unknown): ChatGptRawNode => {
  if (!isRecord(value)) {
    return {
      sourceChildIds: [],
      hasMessage: false,
      partShapes: [],
      hasParts: false,
      attachmentRefs: [],
      malformedReasons: ['node-not-object'],
    };
  }
  const malformedReasons: string[] = [];
  const id = typeof value['id'] === 'string' ? value['id'] : undefined;
  if (!id) malformedReasons.push('node-missing-id');
  const parentId =
    value['parent'] === null
      ? null
      : typeof value['parent'] === 'string'
        ? value['parent']
        : undefined;
  const sourceChildIds = Array.isArray(value['children'])
    ? value['children'].filter((c): c is string => typeof c === 'string')
    : [];

  const message = value['message'];
  if (message == null) {
    return {
      id,
      parentId,
      sourceChildIds,
      hasMessage: false,
      partShapes: [],
      hasParts: false,
      attachmentRefs: [],
      malformedReasons,
    };
  }
  if (!isRecord(message)) {
    malformedReasons.push('message-not-object');
    return {
      id,
      parentId,
      sourceChildIds,
      hasMessage: false,
      partShapes: [],
      hasParts: false,
      attachmentRefs: [],
      malformedReasons,
    };
  }

  const author = isRecord(message['author']) ? message['author'] : undefined;
  const role = typeof author?.['role'] === 'string' ? author['role'] : undefined;
  const content = isRecord(message['content']) ? message['content'] : undefined;
  const contentType =
    typeof content?.['content_type'] === 'string'
      ? content['content_type']
      : undefined;
  const parts = content?.['parts'];
  const hasParts = Array.isArray(parts);
  const partShapes = hasParts ? parts.map(partShape) : [];
  const metadata = isRecord(message['metadata']) ? message['metadata'] : undefined;
  const attachments = Array.isArray(metadata?.['attachments'])
    ? metadata['attachments']
    : [];
  const attachmentRefs = attachments.filter(isRecord).map((a) => ({
    ...(typeof a['id'] === 'string' ? { id: a['id'] } : {}),
    ...(typeof a['mime_type'] === 'string' ? { mimeType: a['mime_type'] } : {}),
    ...(typeof a['size'] === 'number' ? { size: a['size'] } : {}),
    ...(typeof a['library_file_id'] === 'string'
      ? { libraryFileId: a['library_file_id'] }
      : {}),
  }));

  return {
    id,
    parentId,
    sourceChildIds,
    hasMessage: true,
    role,
    ...(typeof message['create_time'] === 'number'
      ? { createTime: message['create_time'] }
      : {}),
    ...(typeof message['update_time'] === 'number'
      ? { updateTime: message['update_time'] }
      : {}),
    contentType,
    partShapes,
    hasParts,
    attachmentRefs,
    malformedReasons,
  };
};

/** Strip one conversation object. Title is dropped. */
export const stripConversation = (value: unknown): ChatGptRawConversation => {
  if (!isRecord(value)) {
    return {
      archived: false,
      nodes: [],
      malformedReasons: ['conversation-not-object'],
    };
  }
  const sourceId =
    typeof value['conversation_id'] === 'string'
      ? value['conversation_id']
      : typeof value['id'] === 'string'
        ? value['id']
        : undefined;
  const mapping = value['mapping'];
  const malformedReasons: string[] = [];
  if (!isRecord(mapping)) {
    malformedReasons.push('mapping-missing');
  }
  const nodes = isRecord(mapping)
    ? Object.values(mapping).map(stripNode)
    : [];
  return {
    sourceId,
    ...(typeof value['create_time'] === 'number'
      ? { createTime: value['create_time'] }
      : {}),
    ...(typeof value['update_time'] === 'number'
      ? { updateTime: value['update_time'] }
      : {}),
    ...(typeof value['current_node'] === 'string'
      ? { currentNodeId: value['current_node'] }
      : {}),
    archived: value['is_archived'] === true,
    nodes,
    malformedReasons,
  };
};
