import {
  buildInventory,
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
});
