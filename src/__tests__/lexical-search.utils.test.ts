import {
  boundSnippet,
  isConversationShardPath,
  lexicalIndexOf,
  uniqueShardReceipts,
  walkShardNodes,
} from '../utils/lexical-search.utils';
import { ObservationReceipt } from '../types';

const receipt = (
  overrides: Partial<ObservationReceipt>,
): ObservationReceipt => ({
  observationId: 'obs-1',
  scopeId: 'keep',
  sourceKind: 'file',
  sourcePath: '/tmp/conversations-000.json',
  capturedAt: '2026-09-01T00:00:00.000Z',
  contentHash: 'aa',
  bytes: 1,
  clockClass: 'meta',
  duplicate: false,
  ...overrides,
});

describe('isConversationShardPath', () => {
  it('accepts numbered conversation shards only', () => {
    expect(isConversationShardPath('/x/conversations-000.json')).toBe(true);
    expect(isConversationShardPath('/x/conversations-001.json')).toBe(true);
    expect(isConversationShardPath('/x/transcript.jsonl')).toBe(false);
    expect(isConversationShardPath('/x/conversations.json')).toBe(false);
  });
});

describe('uniqueShardReceipts', () => {
  it('keeps one receipt per hash in allowed scopes', () => {
    const receipts = [
      receipt({
        contentHash: 'aa',
        capturedAt: '2026-09-01T00:00:00.000Z',
        scopeId: 'keep',
      }),
      receipt({
        contentHash: 'aa',
        capturedAt: '2026-09-02T00:00:00.000Z',
        scopeId: 'keep',
        observationId: 'obs-2',
      }),
      receipt({
        contentHash: 'bb',
        sourcePath: '/x/notes.txt',
        scopeId: 'keep',
      }),
      receipt({ contentHash: 'cc', scopeId: 'forgotten-scope' }),
    ];
    const unique = uniqueShardReceipts(receipts, new Set(['keep']));
    expect(unique).toHaveLength(1);
    expect(unique[0]?.observationId).toBe('obs-2');
  });
});

describe('lexicalIndexOf', () => {
  it('is case-insensitive and rejects empty query', () => {
    expect(lexicalIndexOf('The Path is the data', 'path is the data')).toBe(4);
    expect(lexicalIndexOf('hello', '')).toBe(-1);
    expect(lexicalIndexOf('hello', 'xyz')).toBe(-1);
  });
});

describe('boundSnippet', () => {
  it('centers the first match and marks truncation', () => {
    const text = 'aaaa PATH_MARKER bbbb';
    const snippet = boundSnippet(text, 'PATH_MARKER', 14);
    expect(snippet).toContain('PATH_MARKER');
    expect(snippet.startsWith('…') || snippet.endsWith('…')).toBe(true);
  });
});

describe('walkShardNodes', () => {
  it('includes off-current-path siblings', () => {
    const shard = [
      {
        conversation_id: 'conv-branch',
        current_node: 'node-a',
        mapping: {
          root: { id: 'root', parent: null, message: null },
          'node-a': {
            id: 'node-a',
            parent: 'root',
            message: {
              author: { role: 'user' },
              create_time: 1700000000,
              content: { content_type: 'text', parts: ['ALPHA_ONLY'] },
            },
          },
          'node-b': {
            id: 'node-b',
            parent: 'root',
            message: {
              author: { role: 'assistant' },
              create_time: 1700000060,
              content: { content_type: 'text', parts: ['BETA_ONLY'] },
            },
          },
        },
      },
    ];
    const nodes = walkShardNodes(Buffer.from(JSON.stringify(shard)));
    const texts = nodes.map((n) => n.text).sort();
    expect(texts).toEqual(['ALPHA_ONLY', 'BETA_ONLY']);
    expect(nodes.find((n) => n.text === 'BETA_ONLY')?.eventTime).toBe(
      '2023-11-14T22:14:20.000Z',
    );
  });

  it('returns empty on invalid JSON', () => {
    expect(walkShardNodes(Buffer.from('not-json'))).toEqual([]);
  });
});
