import {
  parseContextPacketRequestFile,
  validateContextPacketRequest,
} from '../utils/context-packet-request.utils';
import {
  boundRawExcerpt,
  eventTimeOfNode,
  extractStringParts,
  parseShardDiagnostics,
} from '../utils/context-packet-extract.utils';
import { matchNodeSelectors } from '../utils/context-packet-select.utils';
import { validateContextPacket } from '../utils/context-packet-validate.utils';
import { validateConsumerClaims } from '../utils/context-packet-consumer.utils';
import {
  CONTEXT_PACKET_POLICY_ID,
  CONTEXT_PACKET_POLICY_VERSION,
  CONTEXT_PACKET_SCHEMA_VERSION,
  ContextPacket,
} from '../types';

const validPacket = (): ContextPacket => ({
  schemaVersion: CONTEXT_PACKET_SCHEMA_VERSION,
  policy: {
    id: CONTEXT_PACKET_POLICY_ID,
    version: CONTEXT_PACKET_POLICY_VERSION,
  },
  status: 'ok',
  generatedAt: '2026-09-17T00:00:00.000Z',
  sourceTimeSemantics: 'vendor-create-time',
  identityResolution: 'not-performed',
  conceptOrigin: 'not-established',
  scopes: ['s'],
  matchMode: 'raw',
  selectors: ['winding path'],
  evidence: [
    {
      handle: 'e01',
      ref: {
        kind: 'vault-node',
        scopeId: 's',
        observationId: 'o1',
        contentHash: 'a'.repeat(64),
        conversationId: 'c',
        nodeId: 'n',
      },
      alternateOccurrences: [],
      role: 'user',
      eventTime: '2024-01-02T12:00:00.000Z',
      eventTimeStatus: 'dated',
      capturedAt: '2026-01-01T00:00:00.000Z',
      branch: 'current-path',
      excerpt: 'winding path',
      excerptKind: 'raw',
      excerptTruncated: false,
      reasons: ['literal-match'],
      selectorIndexes: [0],
    },
  ],
  coverage: {
    discoveredReceipts: 1,
    invalidReceipts: 0,
    receiptEnumerationComplete: true,
    eligibleOccurrences: 1,
    discoveredShards: 1,
    verifiedShards: 1,
    scannedShards: 1,
    failedShards: 0,
    scannedBytes: 10,
    scannedNodes: 1,
    candidateCount: 1,
    selectedCount: 1,
    omittedCount: 0,
    unsupportedContentCount: 0,
    undatedCount: 0,
    scanComplete: true,
    selectionComplete: true,
    earlyExitReasons: [],
  },
  limitations: [
    {
      code: 'identity-resolution-not-performed',
      message: 'x',
    },
    { code: 'concept-origin-not-established', message: 'x' },
    { code: 'expression-is-not-endorsement', message: 'x' },
  ],
  unresolved: [],
  failures: [],
  audit: {
    complete: true,
    policyId: CONTEXT_PACKET_POLICY_ID,
    policyVersion: CONTEXT_PACKET_POLICY_VERSION,
    selectorCount: 1,
    matchMode: 'raw',
    scopeCount: 1,
    stageCounts: {},
    omissionCounts: {},
    selectedReasons: {},
  },
});

describe('context-packet request validation', () => {
  it('rejects empty dataDir, scopes, and selectors', () => {
    expect(
      validateContextPacketRequest({
        dataDir: '  ',
        scopes: ['a'],
        selectors: ['x'],
      }).ok,
    ).toBe(false);
    expect(
      validateContextPacketRequest({
        dataDir: '/tmp/x',
        scopes: [],
        selectors: ['x'],
      }).ok,
    ).toBe(false);
    expect(
      validateContextPacketRequest({
        dataDir: '/tmp/x',
        scopes: ['a'],
        selectors: [],
      }).ok,
    ).toBe(false);
  });

  it('rejects fractional budgets and unknown match mode', () => {
    const badBudget = validateContextPacketRequest({
      dataDir: '/tmp/x',
      scopes: ['a'],
      selectors: ['x'],
      budgets: { maxEvidenceItems: 1.5 },
    });
    expect(badBudget.ok).toBe(false);
    const badMode = validateContextPacketRequest({
      dataDir: '/tmp/x',
      scopes: ['a'],
      selectors: ['x'],
      matchMode: 'fuzzy' as 'raw',
    });
    expect(badMode.ok).toBe(false);
  });

  it('parses a request file and rejects an unsupported schema', () => {
    const ok = parseContextPacketRequestFile({
      dataDir: '/tmp/fixture',
      scopes: ['a'],
      selectors: ['winding path'],
      matchMode: 'raw',
    });
    expect(ok.ok).toBe(true);
    const bad = parseContextPacketRequestFile({
      schemaVersion: 'context-packet/9',
      dataDir: '/tmp/fixture',
      scopes: ['a'],
      selectors: ['x'],
    });
    expect(bad.ok).toBe(false);
  });
});

describe('context-packet extraction', () => {
  it('preserves part offsets across joined strings', () => {
    const extracted = extractStringParts(['hello', 'world']);
    expect(extracted.text).toBe('hello\nworld');
    expect(extracted.parts[1]?.start).toBe(6);
    expect(extracted.parts[1]?.end).toBe(11);
  });

  it('marks non-string parts unsupported without inventing text', () => {
    const extracted = extractStringParts(['ok', { id: 'img' }]);
    expect(extracted.text).toBe('ok');
    expect(extracted.unsupported).toBe(true);
  });

  it('rejects out-of-range create_time', () => {
    expect(
      eventTimeOfNode({
        message: { create_time: 9e15 },
      }).status,
    ).toBe('invalid');
    expect(eventTimeOfNode({ message: {} }).status).toBe('unknown');
  });

  it('parses a shard and marks a parent cycle unknown', () => {
    const shard = [
      {
        conversation_id: 'c1',
        current_node: 'a',
        mapping: {
          a: {
            id: 'a',
            parent: 'b',
            message: {
              author: { role: 'user' },
              create_time: 1704196800,
              content: { parts: ['winding path'] },
            },
          },
          b: {
            id: 'b',
            parent: 'a',
            message: {
              author: { role: 'assistant' },
              create_time: 1704196801,
              content: { parts: ['reply'] },
            },
          },
        },
      },
    ];
    const parsed = parseShardDiagnostics(
      Buffer.from(JSON.stringify(shard), 'utf8'),
    );
    expect(parsed.cyclicOrMissingParent).toBe(true);
    expect(parsed.nodes[0]?.branch).toBe('unknown');
  });

  it('bounds a raw excerpt around the match', () => {
    const parsed = parseShardDiagnostics(
      Buffer.from(
        JSON.stringify([
          {
            conversation_id: 'c',
            current_node: 'n',
            mapping: {
              n: {
                id: 'n',
                parent: null,
                message: {
                  author: { role: 'user' },
                  create_time: 1704196800,
                  content: { parts: ['prefix winding path suffix'] },
                },
              },
            },
          },
        ]),
        'utf8',
      ),
    );
    const node = parsed.nodes[0];
    expect(node).toBeDefined();
    if (node === undefined) return;
    const window = boundRawExcerpt(node, 7, 12, 20);
    expect(window.excerptKind).toBe('raw');
    expect(window.excerpt.toLowerCase()).toContain('winding');
  });
});

describe('context-packet matching', () => {
  it('matches all selectors in one pass', () => {
    const parsed = parseShardDiagnostics(
      Buffer.from(
        JSON.stringify([
          {
            conversation_id: 'c',
            mapping: {
              n: {
                message: {
                  author: { role: 'user' },
                  create_time: 1704196800,
                  content: {
                    parts: ['I am practicing the winding path today'],
                  },
                },
              },
            },
          },
        ]),
        'utf8',
      ),
    );
    const node = parsed.nodes[0];
    expect(node).toBeDefined();
    if (node === undefined) return;
    const hit = matchNodeSelectors(
      node,
      ['winding path', 'practicing the winding path'],
      'raw',
    );
    expect(hit?.indexes).toEqual([0, 1]);
  });
});

describe('context-packet validator and consumer', () => {
  it('rejects missing cautions and forged hashes', () => {
    const packet = validPacket();
    expect(validateContextPacket(packet).ok).toBe(true);
    const noCaution = {
      ...packet,
      identityResolution: 'done',
    };
    expect(validateContextPacket(noCaution).ok).toBe(false);
    const forged = {
      ...packet,
      evidence: [
        {
          ...packet.evidence[0],
          ref: { ...packet.evidence[0].ref, contentHash: 'not-a-hash' },
        },
      ],
    };
    expect(validateContextPacket(forged).ok).toBe(false);
  });

  it('rejects origin, merge, endorsement, and backdating claims', () => {
    const packet = validPacket();
    expect(validateConsumerClaims(packet, [{ kind: 'global-origin' }]).ok).toBe(
      false,
    );
    expect(
      validateConsumerClaims(packet, [
        { kind: 'same-person', evidenceHandles: ['e01'] },
      ]).ok,
    ).toBe(false);
    expect(
      validateConsumerClaims(packet, [
        { kind: 'user-endorsement', evidenceHandles: ['e01'] },
      ]).ok,
    ).toBe(false);
    expect(
      validateConsumerClaims(packet, [
        { kind: 'backdated-meaning', evidenceHandles: ['e01'] },
      ]).ok,
    ).toBe(false);
  });
});
