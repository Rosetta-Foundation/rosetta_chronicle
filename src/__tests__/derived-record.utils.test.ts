import { ChatGptSourceGraph } from '../types';
import { sha256Hex } from '../utils/chatgpt-export.utils';
import {
  DERIVED_RECORD_VERSION,
  buildDerivedRecord,
  defaultReviewState,
  derivedRecordId,
  validateDerivedDraft,
  validateSourceRefsOnGraph,
} from '../utils/derived-record.utils';

const HASH = 'a'.repeat(64);
const CONTENT = 'SYNTHETIC_DERIVED_NOTE';

const graph = (): ChatGptSourceGraph => ({
  archive: {
    contentHash: HASH,
    kind: 'directory',
    importedAt: '2026-08-17T21:00:00.000Z',
    shardNames: ['conversations-000.json'],
    sidecarFiles: [],
  },
  conversations: [
    {
      sourceId: 'conv-1',
      currentNodeId: 'n1',
      archived: false,
      nodes: [
        {
          id: 'n1',
          parentId: null,
          sourceChildIds: [],
          reconstructedChildIds: [],
          hasMessage: true,
          role: 'user',
          attachments: [],
        },
      ],
    },
  ],
  unsupported: [],
});

describe('derived-record.utils', () => {
  it('defaults review state by producer', () => {
    expect(defaultReviewState('human')).toBe('recognized');
    expect(defaultReviewState('agent')).toBe('unreviewed');
  });

  it('rejects an agent without a model and a bad hash', () => {
    expect(
      validateDerivedDraft({
        sourceGraphHash: 'nope',
        nodeIds: [],
        transformationType: 'human-note',
        createdBy: { type: 'agent', name: 'bot' },
        content: CONTENT,
      }),
    ).toEqual(
      expect.arrayContaining([
        'source-graph-hash-invalid',
        'agent-model-missing',
      ]),
    );
  });

  it('builds a record whose id ignores createdAt', () => {
    const refs = [
      { sourceGraphHash: HASH, conversationId: 'conv-1', nodeIds: ['n1'] },
    ];
    const createdBy = { type: 'human' as const, name: 'fixture' };
    const a = buildDerivedRecord({
      sourceRefs: refs,
      transformationType: 'human-note',
      createdBy,
      content: CONTENT,
      createdAt: '2026-08-17T21:00:00.000Z',
      reviewState: 'recognized',
    });
    const b = buildDerivedRecord({
      sourceRefs: refs,
      transformationType: 'human-note',
      createdBy,
      content: CONTENT,
      createdAt: '2026-08-18T00:00:00.000Z',
      reviewState: 'recognized',
    });
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(
      derivedRecordId(refs, 'human-note', createdBy, sha256Hex(CONTENT)),
    );
    expect(a.contentRef).toBe(sha256Hex(CONTENT));
    expect(a.transformationVersion).toBe(DERIVED_RECORD_VERSION);
    expect(a.content).toBe(CONTENT);
  });

  it('flags missing conversation and node ids on a loaded graph', () => {
    expect(
      validateSourceRefsOnGraph(graph(), {
        sourceGraphHash: HASH,
        conversationId: 'conv-missing',
        nodeIds: ['n1'],
      }),
    ).toContain('conversation-missing:conv-missing');
    expect(
      validateSourceRefsOnGraph(graph(), {
        sourceGraphHash: HASH,
        conversationId: 'conv-1',
        nodeIds: ['n-missing'],
      }),
    ).toContain('node-missing:n-missing');
  });
});
