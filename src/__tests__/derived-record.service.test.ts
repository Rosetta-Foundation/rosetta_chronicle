import 'reflect-metadata';
import { Container } from 'inversify';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ChatGptSourceGraph, DerivedRecordInput } from '../types';

const { CHRONICLE_TOKENS } = require('../tokens');
const {
  DerivedRecordService,
} = require('../services/derived-record.service');
const {
  DerivedRecordStore,
} = require('../repositories/derived-record-store.repository');
const {
  ChatGptGraphStore,
} = require('../repositories/chatgpt-graph-store.repository');

const HASH = 'b'.repeat(64);
const CREATED = '2026-08-17T21:00:00.000Z';
const CONTENT = 'SYNTHETIC_DERIVED_NOTE';

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
      ],
    },
  ],
  unsupported: [],
});

const baseInput = (outputDir: string): DerivedRecordInput => ({
  outputDir,
  sourceGraphHash: HASH,
  conversationId: 'conv-1',
  nodeIds: ['n1'],
  transformationType: 'human-note',
  createdBy: { type: 'human', name: 'fixture' },
  content: CONTENT,
  createdAt: CREATED,
});

describe('DerivedRecordService', () => {
  let outputDir: string;
  let service: { record: (input: DerivedRecordInput) => Promise<Record<string, unknown>> };

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'derived-record-'));
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.DerivedRecordStore)
      .to(DerivedRecordStore);
    container.bind(CHRONICLE_TOKENS.ChatGptGraphStore).to(ChatGptGraphStore);
    container
      .bind(CHRONICLE_TOKENS.DerivedRecordService)
      .to(DerivedRecordService);
    service = container.get(CHRONICLE_TOKENS.DerivedRecordService);
  });
  afterEach(() => rmSync(outputDir, { recursive: true, force: true }));

  it('persists a human note with provenance and no Daily Chronicle', async () => {
    const result = await service.record(baseInput(outputDir));
    expect(result.status).toBe('recorded');
    expect(result.reviewState).toBe('recognized');
    expect(result.createdAt).toBe(CREATED);
    expect(result.path).toBe(join(outputDir, `${result.id}.json`));
    const dumped = readFileSync(result.path as string, 'utf-8');
    const record = JSON.parse(dumped);
    expect(record.sourceRefs[0]).toEqual({
      sourceGraphHash: HASH,
      conversationId: 'conv-1',
      nodeIds: ['n1'],
    });
    expect(record.content).toBe(CONTENT);
    expect(dumped).not.toMatch(/"source"\s*:\s*"chatgpt-export"/);
    expect(existsSync(join(outputDir, 'chronicles'))).toBe(false);
  });

  it('re-record of the same stable fields keeps createdAt', async () => {
    const first = await service.record(baseInput(outputDir));
    const second = await service.record({
      ...baseInput(outputDir),
      createdAt: '2026-08-18T00:00:00.000Z',
    });
    expect(second.status).toBe('already-present');
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(CREATED);
  });

  it('dry-run does not write', async () => {
    const result = await service.record({
      ...baseInput(outputDir),
      dryRun: true,
    });
    expect(result.status).toBe('recorded');
    expect(existsSync(result.path as string)).toBe(false);
  });

  it('validates refs against an optional source-graph file', async () => {
    const graphPath = join(outputDir, 'graph.json');
    writeFileSync(graphPath, JSON.stringify(graph()));
    const ok = await service.record({
      ...baseInput(outputDir),
      graphPath,
    });
    expect(ok.status).toBe('recorded');
    const bad = await service.record({
      ...baseInput(outputDir),
      nodeIds: ['n-missing'],
      content: 'SYNTHETIC_OTHER_NOTE',
      graphPath,
    });
    expect(bad.status).toBe('invalid');
    expect(bad.error).toContain('node-missing:n-missing');
  });

  it('rejects an agent transformation without a model', async () => {
    const result = await service.record({
      ...baseInput(outputDir),
      createdBy: { type: 'agent', name: 'bot' },
    });
    expect(result.status).toBe('invalid');
    expect(result.error).toContain('agent-model-missing');
  });

  it('rejects candidate-observation; that type is interpret-source only', async () => {
    const result = await service.record({
      ...baseInput(outputDir),
      transformationType: 'candidate-observation',
      createdBy: {
        type: 'agent',
        name: 'chronicle-interpret',
        model: 'synthetic-model',
      },
    });
    expect(result.status).toBe('invalid');
    expect(result.error).toContain(
      'machine-type-not-caller-supplied:candidate-observation',
    );
  });
});
