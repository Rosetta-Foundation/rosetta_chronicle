import {
  attachmentPresentInArchive,
  buildInventory,
  buildSourceGraph,
  childIdsFromParents,
  partShape,
  reconstructChildIds,
  sha256Hex,
  stripConversation,
  stripNode,
  unixSecondsToIso,
} from '../utils/chatgpt-export.utils';
import { ChatGptRawExport, ChatGptRawNode } from '../types';

describe('chatgpt-export.utils', () => {
  it('hashes bytes deterministically', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex(Buffer.from('abc')));
    expect(sha256Hex('abc')).not.toBe(sha256Hex('abd'));
  });

  it('converts unix seconds to ISO without treating them as ms', () => {
    expect(unixSecondsToIso(1700000000)).toBe('2023-11-14T22:13:20.000Z');
  });

  it('classifies part shapes without keeping payloads', () => {
    expect(partShape('secret')).toEqual({ kind: 'string' });
    expect(partShape({ content_type: 'image_asset_pointer' })).toEqual({
      kind: 'object',
      objectType: 'image_asset_pointer',
    });
    expect(partShape(null)).toEqual({ kind: 'null' });
  });

  it('reconstructs children from parent links when source children are empty', () => {
    const nodes: ChatGptRawNode[] = [
      {
        id: 'root',
        parentId: null,
        sourceChildIds: [],
        hasMessage: false,
        partShapes: [],
        hasParts: false,
        attachmentRefs: [],
        malformedReasons: [],
      },
      {
        id: 'a',
        parentId: 'root',
        sourceChildIds: [],
        hasMessage: true,
        partShapes: [],
        hasParts: false,
        attachmentRefs: [],
        malformedReasons: [],
      },
      {
        id: 'b',
        parentId: 'root',
        sourceChildIds: [],
        hasMessage: true,
        partShapes: [],
        hasParts: false,
        attachmentRefs: [],
        malformedReasons: [],
      },
    ];
    expect(reconstructChildIds(nodes).get('root')).toEqual(['a', 'b']);
    expect(childIdsFromParents(nodes).get('root')).toEqual(['a', 'b']);
  });

  it('keeps source children out of parent-only reconstruction', () => {
    const nodes: ChatGptRawNode[] = [
      {
        id: 'root',
        parentId: null,
        sourceChildIds: ['only-in-source'],
        hasMessage: false,
        partShapes: [],
        hasParts: false,
        attachmentRefs: [],
        malformedReasons: [],
      },
      {
        id: 'a',
        parentId: 'root',
        sourceChildIds: [],
        hasMessage: true,
        partShapes: [],
        hasParts: false,
        attachmentRefs: [],
        malformedReasons: [],
      },
    ];
    expect(reconstructChildIds(nodes).get('root')).toEqual([
      'only-in-source',
      'a',
    ]);
    expect(childIdsFromParents(nodes).get('root')).toEqual(['a']);
  });

  it('strips titles and message text from a conversation', () => {
    const stripped = stripConversation({
      id: 'c1',
      conversation_id: 'c1',
      title: 'SYNTHETIC_TITLE_MUST_NOT_LEAK',
      mapping: {
        n1: {
          id: 'n1',
          parent: null,
          message: {
            author: { role: 'user' },
            create_time: 1,
            content: {
              content_type: 'text',
              parts: ['REDACTED_SHOULD_NOT_LEAK'],
            },
          },
        },
      },
    });
    expect(stripped.sourceId).toBe('c1');
    expect(JSON.stringify(stripped)).not.toContain('REDACTED_SHOULD_NOT_LEAK');
    expect(JSON.stringify(stripped)).not.toContain(
      'SYNTHETIC_TITLE_MUST_NOT_LEAK',
    );
    expect(stripped.nodes[0].partShapes).toEqual([{ kind: 'string' }]);
  });

  it('treats attachment.id + ".dat" as the archive presence mapping', () => {
    // Contract: metadata.attachments[].id is present iff the archive lists
    // `{id}.dat`. Display names and library catalog rows are not archive keys.
    const archive = [
      'file-fixture-present.dat',
      'conversations-000.json',
      'conversation_asset_file_names.json',
      'library_files.json',
    ];
    expect(
      attachmentPresentInArchive('file-fixture-present', archive),
    ).toBe(true);
    expect(
      attachmentPresentInArchive('file-missing-from-archive', archive),
    ).toBe(false);
    expect(
      attachmentPresentInArchive('original-display-name.jpeg', archive),
    ).toBe(false);
    expect(attachmentPresentInArchive('libfile_catalog_only', archive)).toBe(
      false,
    );
  });

  it('marks non-object mapping entries as malformed', () => {
    expect(stripNode('nope').malformedReasons).toContain('node-not-object');
  });

  it('keeps ingestedAt distinct from eventTimeRange', () => {
    const raw: ChatGptRawExport = {
      kind: 'directory',
      contentHash: 'abc',
      shardNames: ['conversations-000.json'],
      sidecarFiles: ['user.json'],
      archiveFiles: ['conversations-000.json', 'user.json'],
      conversations: [
        {
          sourceId: 'c1',
          createTime: 1700000000,
          updateTime: 1700000600,
          archived: false,
          malformedReasons: [],
          nodes: [
            {
              id: 'n1',
              parentId: null,
              sourceChildIds: [],
              hasMessage: true,
              role: 'user',
              createTime: 1700000001,
              contentType: 'text',
              partShapes: [{ kind: 'string' }],
              hasParts: true,
              attachmentRefs: [],
              malformedReasons: [],
            },
          ],
        },
      ],
      unsupported: [],
    };
    const inventory = buildInventory(
      raw,
      '/tmp/export',
      '2026-08-17T21:00:00.000Z',
    );
    expect(inventory.ingestedAt).toBe('2026-08-17T21:00:00.000Z');
    expect(inventory.eventTimeRange?.start).toBe('2023-11-14T22:13:20.000Z');
    expect(inventory.eventTimeRange?.end).toBe('2023-11-14T22:23:20.000Z');
    expect(inventory.privacySignals).toEqual(['user.json']);
  });

  it('builds a source graph without titles, parts, or filenames', () => {
    const raw: ChatGptRawExport = {
      kind: 'directory',
      contentHash: 'a'.repeat(64),
      shardNames: ['conversations-000.json'],
      sidecarFiles: ['user.json', 'export_manifest.json'],
      archiveFiles: [
        'conversations-000.json',
        'user.json',
        'file-present.dat',
      ],
      conversations: [
        {
          sourceId: 'c-branch',
          currentNodeId: 'n-a',
          createTime: 1700000000,
          updateTime: 1700000600,
          archived: false,
          malformedReasons: [],
          nodes: [
            {
              id: 'n-root',
              parentId: null,
              sourceChildIds: [],
              hasMessage: false,
              partShapes: [],
              hasParts: false,
              attachmentRefs: [],
              malformedReasons: [],
            },
            {
              id: 'n-a',
              parentId: 'n-root',
              sourceChildIds: [],
              hasMessage: true,
              role: 'user',
              createTime: 1700000001,
              contentType: 'text',
              partShapes: [{ kind: 'string' }],
              hasParts: true,
              attachmentRefs: [
                { id: 'file-present', mimeType: 'image/png', size: 12 },
                { id: 'file-absent', mimeType: 'application/pdf', size: 4 },
              ],
              malformedReasons: [],
            },
            {
              id: 'n-b',
              parentId: 'n-root',
              sourceChildIds: [],
              hasMessage: true,
              role: 'user',
              createTime: 1700000002,
              contentType: 'text',
              partShapes: [{ kind: 'string' }],
              hasParts: true,
              attachmentRefs: [],
              malformedReasons: [],
            },
          ],
        },
        {
          sourceId: 'c-explicit',
          currentNodeId: 'n-ex-a',
          archived: false,
          malformedReasons: [],
          nodes: [
            {
              id: 'n-ex-root',
              parentId: null,
              sourceChildIds: ['n-ex-a', 'n-ex-b'],
              hasMessage: false,
              partShapes: [],
              hasParts: false,
              attachmentRefs: [],
              malformedReasons: [],
            },
            {
              id: 'n-ex-a',
              parentId: 'n-ex-root',
              sourceChildIds: [],
              hasMessage: true,
              role: 'user',
              partShapes: [],
              hasParts: false,
              attachmentRefs: [],
              malformedReasons: [],
            },
            {
              id: 'n-ex-b',
              parentId: 'n-ex-root',
              sourceChildIds: [],
              hasMessage: true,
              role: 'assistant',
              partShapes: [],
              hasParts: false,
              attachmentRefs: [],
              malformedReasons: [],
            },
          ],
        },
      ],
      unsupported: [],
    };
    const graph = buildSourceGraph(raw, '2026-08-17T21:00:00.000Z');
    const dumped = JSON.stringify(graph);
    expect(dumped).not.toContain('REDACTED_SHOULD_NOT_LEAK');
    expect(dumped).not.toContain('SYNTHETIC_TITLE_MUST_NOT_LEAK');
    expect(dumped).not.toContain('REDACTED_FILENAME_MUST_NOT_LEAK');
    expect(graph.archive.importedAt).toBe('2026-08-17T21:00:00.000Z');
    expect(graph.archive.contentHash).toBe('a'.repeat(64));
    expect(graph.archive.sidecarFiles).toEqual([
      'export_manifest.json',
      'user.json',
    ]);

    const branched = graph.conversations.find((c) => c.sourceId === 'c-branch');
    const root = branched?.nodes.find((n) => n.id === 'n-root');
    expect(root?.sourceChildIds).toEqual([]);
    expect(root?.reconstructedChildIds).toEqual(['n-a', 'n-b']);
    expect(branched?.currentNodeId).toBe('n-a');
    expect(branched?.createTime).toBe('2023-11-14T22:13:20.000Z');

    const withAttach = branched?.nodes.find((n) => n.id === 'n-a');
    expect(withAttach?.attachments).toEqual([
      {
        id: 'file-present',
        mimeType: 'image/png',
        size: 12,
        presentInArchive: true,
      },
      {
        id: 'file-absent',
        mimeType: 'application/pdf',
        size: 4,
        presentInArchive: false,
      },
    ]);
    expect(graph.unsupported.map((u) => u.reason)).toContain(
      'attachment-missing-from-archive',
    );

    const explicit = graph.conversations.find(
      (c) => c.sourceId === 'c-explicit',
    );
    const exRoot = explicit?.nodes.find((n) => n.id === 'n-ex-root');
    expect(exRoot?.sourceChildIds).toEqual(['n-ex-a', 'n-ex-b']);
    expect(exRoot?.reconstructedChildIds).toEqual(['n-ex-a', 'n-ex-b']);
  });
});
