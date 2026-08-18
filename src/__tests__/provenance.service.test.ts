import 'reflect-metadata';
import { Container } from 'inversify';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ChatGptSourceGraph, TransformRecordInput } from '../types';

const { CHRONICLE_TOKENS } = require('../tokens');
const {
  TransformationService,
} = require('../services/transformation.service');
const {
  DerivedRecordService,
} = require('../services/derived-record.service');
const { ProvenanceService } = require('../services/provenance.service');
const {
  DerivedRecordStore,
} = require('../repositories/derived-record-store.repository');
const {
  ChatGptGraphStore,
} = require('../repositories/chatgpt-graph-store.repository');
const {
  TransformationRegistry,
} = require('../repositories/transformation-registry.repository');
const {
  TransformationExecutionStore,
} = require('../repositories/transformation-execution-store.repository');
const {
  TransformationDefinitionStore,
} = require('../repositories/transformation-definition-store.repository');
const {
  EvaluationStore,
} = require('../repositories/evaluation-store.repository');
const {
  EvaluationService,
} = require('../services/evaluation.service');

const HASH = 'b'.repeat(64);
const HASH_B = 'd'.repeat(64);
const CREATED = '2026-08-17T21:00:00.000Z';

const graph = (): ChatGptSourceGraph => ({
  archive: {
    contentHash: HASH,
    kind: 'directory',
    importedAt: CREATED,
    shardNames: [],
    sidecarFiles: [],
  },
  conversations: [
    {
      sourceId: 'conv-1',
      archived: false,
      nodes: [
        {
          id: 'n1',
          sourceChildIds: [],
          reconstructedChildIds: [],
          hasMessage: true,
          attachments: [],
        },
        {
          id: 'n2',
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

const transformInput = (
  outputDir: string,
  executionsDir: string,
  definitionsDir: string,
): TransformRecordInput => ({
  outputDir,
  executionsDir,
  definitionsDir,
  sourceGraphHash: HASH,
  conversationId: 'conv-1',
  nodeIds: ['n1'],
  transformationType: 'human-note',
  transformationVersion: '1',
  createdBy: { type: 'human', name: 'fixture' },
  content: 'SYNTHETIC_DERIVED_NOTE',
  createdAt: CREATED,
});

describe('ProvenanceService', () => {
  let outputDir: string;
  let executionsDir: string;
  let definitionsDir: string;
  let graphsDir: string;
  let evaluationsDir: string;
  let transform: {
    transform: (input: TransformRecordInput) => Promise<Record<string, unknown>>;
  };
  let derived: {
    record: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  let provenance: {
    traverse: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  let evaluate: {
    evaluate: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };

  beforeEach(async () => {
    outputDir = mkdtempSync(join(tmpdir(), 'prov-derived-'));
    executionsDir = mkdtempSync(join(tmpdir(), 'prov-exec-'));
    definitionsDir = mkdtempSync(join(tmpdir(), 'prov-def-'));
    graphsDir = mkdtempSync(join(tmpdir(), 'prov-graph-'));
    evaluationsDir = mkdtempSync(join(tmpdir(), 'prov-eval-'));
    const container = new Container();
    container.bind(CHRONICLE_TOKENS.DerivedRecordStore).to(DerivedRecordStore);
    container.bind(CHRONICLE_TOKENS.ChatGptGraphStore).to(ChatGptGraphStore);
    container
      .bind(CHRONICLE_TOKENS.TransformationRegistry)
      .to(TransformationRegistry);
    container
      .bind(CHRONICLE_TOKENS.TransformationDefinitionStore)
      .to(TransformationDefinitionStore);
    container
      .bind(CHRONICLE_TOKENS.TransformationExecutionStore)
      .to(TransformationExecutionStore);
    container.bind(CHRONICLE_TOKENS.EvaluationStore).to(EvaluationStore);
    container.bind(CHRONICLE_TOKENS.EvaluationService).to(EvaluationService);
    container
      .bind(CHRONICLE_TOKENS.TransformationService)
      .to(TransformationService);
    container
      .bind(CHRONICLE_TOKENS.DerivedRecordService)
      .to(DerivedRecordService);
    container.bind(CHRONICLE_TOKENS.ProvenanceService).to(ProvenanceService);
    transform = container.get(CHRONICLE_TOKENS.TransformationService);
    derived = container.get(CHRONICLE_TOKENS.DerivedRecordService);
    provenance = container.get(CHRONICLE_TOKENS.ProvenanceService);
    evaluate = container.get(CHRONICLE_TOKENS.EvaluationService);
    const store = new ChatGptGraphStore();
    await store.write(graphsDir, graph());
  });
  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
    rmSync(executionsDir, { recursive: true, force: true });
    rmSync(definitionsDir, { recursive: true, force: true });
    rmSync(graphsDir, { recursive: true, force: true });
    rmSync(evaluationsDir, { recursive: true, force: true });
  });

  const dirs = () => ({
    graphsDir,
    outputDir,
    executionsDir,
    definitionsDir,
  });

  it('walks backward from a transform-produced derived record', async () => {
    const recorded = await transform.transform(
      transformInput(outputDir, executionsDir, definitionsDir),
    );
    const result = await provenance.traverse({
      ...dirs(),
      start: { kind: 'derived-record', id: (recorded.derivedIds as string[])[0] },
      direction: 'backward',
    });
    expect(result.status).toBe('ok');
    const kinds = (result.nodes as { kind: string }[]).map((n) => n.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'derived-record',
        'transformation-execution',
        'transformation-definition',
        'source-archive',
        'source-conversation',
        'source-node',
      ]),
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'produces' }),
        expect.objectContaining({ type: 'cites' }),
        expect.objectContaining({ type: 'contains' }),
      ]),
    );
    expect(existsSync(join(outputDir, 'chronicles'))).toBe(false);
  });

  it('walks forward from a source node to execution and both derived kinds', async () => {
    const first = await transform.transform(
      transformInput(outputDir, executionsDir, definitionsDir),
    );
    const second = await transform.transform({
      ...transformInput(outputDir, executionsDir, definitionsDir),
      content: 'SYNTHETIC_OTHER_NOTE',
    });
    const direct = await derived.record({
      outputDir,
      sourceGraphHash: HASH,
      conversationId: 'conv-1',
      nodeIds: ['n1'],
      transformationType: 'human-note',
      createdBy: { type: 'human', name: 'fixture' },
      content: 'SYNTHETIC_DIRECT_NOTE',
      createdAt: CREATED,
    });
    const result = await provenance.traverse({
      ...dirs(),
      start: { kind: 'source-node', id: `${HASH}:conv-1:n1` },
      direction: 'forward',
    });
    expect(result.status).toBe('ok');
    const derivedIds = (result.nodes as { kind: string; id: string }[])
      .filter((n) => n.kind === 'derived-record')
      .map((n) => n.id)
      .sort();
    expect(derivedIds).toEqual(
      [
        (first.derivedIds as string[])[0],
        (second.derivedIds as string[])[0],
        direct.id as string,
      ].sort(),
    );
    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'transformation-execution',
          id: first.executionId,
        }),
      ]),
    );
  });

  it('does not pull sibling derived records onto a backward walk', async () => {
    const first = await transform.transform(
      transformInput(outputDir, executionsDir, definitionsDir),
    );
    const direct = await derived.record({
      outputDir,
      sourceGraphHash: HASH,
      conversationId: 'conv-1',
      nodeIds: ['n1'],
      transformationType: 'human-note',
      createdBy: { type: 'human', name: 'fixture' },
      content: 'SYNTHETIC_DIRECT_NOTE',
      createdAt: CREATED,
    });
    const result = await provenance.traverse({
      ...dirs(),
      start: { kind: 'derived-record', id: (first.derivedIds as string[])[0] },
      direction: 'backward',
    });
    const derivedIds = (result.nodes as { kind: string; id: string }[])
      .filter((n) => n.kind === 'derived-record')
      .map((n) => n.id);
    expect(derivedIds).toEqual([(first.derivedIds as string[])[0]]);
    expect(derivedIds).not.toContain(direct.id);
  });

  it('includes multiple source nodes cited by one execution', async () => {
    const recorded = await transform.transform({
      ...transformInput(outputDir, executionsDir, definitionsDir),
      nodeIds: ['n1', 'n2'],
    });
    const result = await provenance.traverse({
      ...dirs(),
      start: { kind: 'derived-record', id: (recorded.derivedIds as string[])[0] },
      direction: 'backward',
    });
    const nodeIds = (result.nodes as { kind: string; id: string }[])
      .filter((n) => n.kind === 'source-node')
      .map((n) => n.id)
      .sort();
    expect(nodeIds).toEqual([`${HASH}:conv-1:n1`, `${HASH}:conv-1:n2`]);
  });

  it('returns not-found for a missing start and partial for a broken definition', async () => {
    const missing = await provenance.traverse({
      ...dirs(),
      start: { kind: 'derived-record', id: 'c'.repeat(64) },
      direction: 'backward',
    });
    expect(missing.status).toBe('not-found');
    expect(missing.error).toBe('start-missing');

    const recorded = await transform.transform(
      transformInput(outputDir, executionsDir, definitionsDir),
    );
    rmSync(recorded.definitionPath as string);
    const broken = await provenance.traverse({
      ...dirs(),
      start: { kind: 'derived-record', id: (recorded.derivedIds as string[])[0] },
      direction: 'backward',
    });
    expect(broken.status).toBe('partial');
    expect(
      (broken.failures as { code: string }[]).map((row) => row.code),
    ).toContain('definition-missing');
    expect(broken.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'transformation-definition',
          resolved: false,
        }),
        expect.objectContaining({
          kind: 'transformation-execution',
          resolved: true,
        }),
      ]),
    );
  });

  it('reports a missing produced derived and a missing graph node cite', async () => {
    const recorded = await transform.transform(
      transformInput(outputDir, executionsDir, definitionsDir),
    );
    rmSync((recorded.derivedPaths as string[])[0]);
    const fromExec = await provenance.traverse({
      ...dirs(),
      start: {
        kind: 'transformation-execution',
        id: recorded.executionId as string,
      },
      direction: 'forward',
    });
    expect(fromExec.status).toBe('partial');
    expect(
      (fromExec.failures as { code: string }[]).map((row) => row.code),
    ).toContain('derived-missing');

    writeFileSync(
      join(graphsDir, `${HASH}.json`),
      JSON.stringify({
        ...graph(),
        conversations: [
          {
            sourceId: 'conv-1',
            archived: false,
            nodes: [
              {
                id: 'n-only',
                sourceChildIds: [],
                reconstructedChildIds: [],
                hasMessage: true,
                attachments: [],
              },
            ],
          },
        ],
      }),
    );
    const fromDerived = await provenance.traverse({
      ...dirs(),
      start: {
        kind: 'transformation-execution',
        id: recorded.executionId as string,
      },
      direction: 'backward',
    });
    expect(fromDerived.status).toBe('partial');
    expect(
      (fromDerived.failures as { code: string }[]).map((row) => row.code),
    ).toContain('node-missing');
  });

  it('isolates integrity failures to the requested subgraph', async () => {
    const healthy = await transform.transform(
      transformInput(outputDir, executionsDir, definitionsDir),
    );
    const broken = await transform.transform({
      ...transformInput(outputDir, executionsDir, definitionsDir),
      sourceGraphHash: HASH_B,
      conversationId: 'conv-b',
      nodeIds: ['nb'],
      transformationType: 'reflection',
      content: 'SYNTHETIC_DISCONNECTED_NOTE',
    });
    rmSync(broken.definitionPath as string);
    writeFileSync(join(executionsDir, `${'e'.repeat(64)}.json`), '{');
    writeFileSync(join(outputDir, `${'f'.repeat(64)}.json`), '{');

    const fromA = await provenance.traverse({
      ...dirs(),
      start: {
        kind: 'derived-record',
        id: (healthy.derivedIds as string[])[0],
      },
      direction: 'backward',
    });
    expect(fromA.status).toBe('ok');
    expect(fromA.failures).toEqual([]);
    const aIds = (fromA.nodes as { id: string }[]).map((n) => n.id);
    expect(aIds).not.toContain((broken.derivedIds as string[])[0]);
    expect(aIds).not.toContain(HASH_B);

    const fromB = await provenance.traverse({
      ...dirs(),
      start: {
        kind: 'derived-record',
        id: (broken.derivedIds as string[])[0],
      },
      direction: 'backward',
    });
    expect(fromB.status).toBe('partial');
    expect(
      (fromB.failures as { code: string }[]).map((row) => row.code).sort(),
    ).toEqual(['definition-missing', 'source-graph-missing']);
  });

  it('orders nodes deterministically across repeated walks', async () => {
    await transform.transform(
      transformInput(outputDir, executionsDir, definitionsDir),
    );
    const start = { kind: 'source-archive' as const, id: HASH };
    const a = await provenance.traverse({
      ...dirs(),
      start,
      direction: 'forward',
    });
    const b = await provenance.traverse({
      ...dirs(),
      start,
      direction: 'forward',
    });
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
    expect(JSON.stringify(a.edges)).toBe(JSON.stringify(b.edges));
    expect(JSON.stringify(a.paths)).toBe(JSON.stringify(b.paths));
  });

  it('walks source → execution → derived → evaluation forward', async () => {
    const recorded = await transform.transform(
      transformInput(outputDir, executionsDir, definitionsDir),
    );
    const derivedId = (recorded.derivedIds as string[])[0];
    const ev = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: derivedId,
      evaluatorName: 'operator',
      evidenceSupport: 'supported',
      evaluatedAt: CREATED,
    });
    const result = await provenance.traverse({
      ...dirs(),
      evaluationsDir,
      start: { kind: 'source-node', id: `${HASH}:conv-1:n1` },
      direction: 'forward',
    });
    expect(result.status).toBe('ok');
    const kinds = (result.nodes as { kind: string }[]).map((n) => n.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'source-node',
        'transformation-execution',
        'derived-record',
        'evaluation',
      ]),
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'evaluates',
          from: { kind: 'evaluation', id: ev.id },
          to: { kind: 'derived-record', id: derivedId },
        }),
      ]),
    );
    const pathKinds = (result.paths as { nodes: { kind: string }[] }[]).some(
      (path) => {
        const sequence = path.nodes.map((n) => n.kind).join('>');
        return (
          sequence.includes('source-node') &&
          sequence.includes('transformation-execution') &&
          sequence.includes('derived-record') &&
          sequence.includes('evaluation')
        );
      },
    );
    expect(pathKinds).toBe(true);
  });

  it('walks backward from evaluation to source and marks a later hole', async () => {
    const recorded = await transform.transform(
      transformInput(outputDir, executionsDir, definitionsDir),
    );
    const derivedId = (recorded.derivedIds as string[])[0];
    const ev = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: derivedId,
      evaluatorName: 'operator',
      evidenceSupport: 'supported',
      evaluatedAt: CREATED,
    });
    const ok = await provenance.traverse({
      ...dirs(),
      evaluationsDir,
      start: { kind: 'evaluation', id: ev.id as string },
      direction: 'backward',
    });
    expect(ok.status).toBe('ok');
    const kinds = (ok.nodes as { kind: string }[]).map((n) => n.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'evaluation',
        'derived-record',
        'transformation-execution',
        'transformation-definition',
        'source-node',
      ]),
    );

    rmSync(join(outputDir, `${derivedId}.json`));
    const hole = await provenance.traverse({
      ...dirs(),
      evaluationsDir,
      start: { kind: 'evaluation', id: ev.id as string },
      direction: 'backward',
    });
    expect(hole.status).toBe('partial');
    expect(
      (hole.failures as { code: string }[]).map((row) => row.code),
    ).toContain('evaluated-record-missing');
  });

  it('cites a supplied correction record from the evaluation', async () => {
    const x = await transform.transform(
      transformInput(outputDir, executionsDir, definitionsDir),
    );
    const y = await derived.record({
      outputDir,
      sourceGraphHash: HASH,
      conversationId: 'conv-1',
      nodeIds: ['n1'],
      transformationType: 'human-note',
      createdBy: { type: 'human', name: 'fixture' },
      content: 'SYNTHETIC_HUMAN_Y',
      createdAt: CREATED,
    });
    const ev = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: (x.derivedIds as string[])[0],
      evaluatorName: 'operator',
      evidenceSupport: 'not-supported',
      suppliedRecordId: y.id,
      evaluatedAt: CREATED,
    });
    const result = await provenance.traverse({
      ...dirs(),
      evaluationsDir,
      start: { kind: 'evaluation', id: ev.id as string },
      direction: 'backward',
    });
    expect(result.status).toBe('ok');
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'cites',
          from: { kind: 'evaluation', id: ev.id },
          to: { kind: 'derived-record', id: y.id },
        }),
      ]),
    );
  });

  it('cites a preceding evaluation in both walk directions', async () => {
    const recorded = await transform.transform(
      transformInput(outputDir, executionsDir, definitionsDir),
    );
    const derivedId = (recorded.derivedIds as string[])[0];
    const first = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: derivedId,
      evaluatorName: 'operator',
      evidenceSupport: 'supported',
      evaluatedAt: CREATED,
    });
    const second = await evaluate.evaluate({
      outputDir,
      evaluationsDir,
      evaluatedRecordId: derivedId,
      evaluatorName: 'operator',
      evidenceSupport: 'uncertain',
      precedingEvaluationId: first.id,
      evaluatedAt: '2026-08-18T23:00:00.000Z',
    });
    expect(second.status).toBe('recorded');

    const backward = await provenance.traverse({
      ...dirs(),
      evaluationsDir,
      start: { kind: 'evaluation', id: second.id as string },
      direction: 'backward',
    });
    expect(backward.status).toBe('ok');
    expect(backward.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'cites',
          from: { kind: 'evaluation', id: second.id },
          to: { kind: 'evaluation', id: first.id },
        }),
      ]),
    );
    expect((backward.nodes as { id: string }[]).map((n) => n.id)).toContain(
      first.id,
    );

    const forward = await provenance.traverse({
      ...dirs(),
      evaluationsDir,
      start: { kind: 'evaluation', id: first.id as string },
      direction: 'forward',
    });
    expect(forward.status).toBe('ok');
    expect((forward.nodes as { id: string }[]).map((n) => n.id)).toContain(
      second.id,
    );

    rmSync(join(evaluationsDir, `${first.id}.json`));
    const hole = await provenance.traverse({
      ...dirs(),
      evaluationsDir,
      start: { kind: 'evaluation', id: second.id as string },
      direction: 'backward',
    });
    expect(hole.status).toBe('partial');
    expect(
      (hole.failures as { code: string }[]).map((row) => row.code),
    ).toContain('preceding-evaluation-missing');
  });
});
