import 'reflect-metadata';
import { Container } from 'inversify';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TransformRecordInput } from '../types';

const { CHRONICLE_TOKENS } = require('../tokens');
const {
  TransformationService,
} = require('../services/transformation.service');
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

const HASH = 'b'.repeat(64);
const CREATED = '2026-08-17T21:00:00.000Z';
const CONTENT = 'SYNTHETIC_DERIVED_NOTE';

const baseInput = (
  outputDir: string,
  executionsDir: string,
): TransformRecordInput => ({
  outputDir,
  executionsDir,
  sourceGraphHash: HASH,
  conversationId: 'conv-1',
  nodeIds: ['n1'],
  transformationType: 'human-note',
  transformationVersion: '1',
  createdBy: { type: 'human', name: 'fixture' },
  content: CONTENT,
  createdAt: CREATED,
});

describe('TransformationService', () => {
  let outputDir: string;
  let executionsDir: string;
  let service: {
    transform: (
      input: TransformRecordInput,
    ) => Promise<Record<string, unknown>>;
    provenance: (query: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'derived-xform-'));
    executionsDir = mkdtempSync(join(tmpdir(), 'exec-xform-'));
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.DerivedRecordStore)
      .to(DerivedRecordStore);
    container.bind(CHRONICLE_TOKENS.ChatGptGraphStore).to(ChatGptGraphStore);
    container
      .bind(CHRONICLE_TOKENS.TransformationRegistry)
      .to(TransformationRegistry);
    container
      .bind(CHRONICLE_TOKENS.TransformationExecutionStore)
      .to(TransformationExecutionStore);
    container
      .bind(CHRONICLE_TOKENS.TransformationService)
      .to(TransformationService);
    service = container.get(CHRONICLE_TOKENS.TransformationService);
  });
  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
    rmSync(executionsDir, { recursive: true, force: true });
  });

  it('persists an execution and derived record without Activity', async () => {
    const result = await service.transform(baseInput(outputDir, executionsDir));
    expect(result.status).toBe('recorded');
    expect(result.createdAt).toBe(CREATED);
    expect(existsSync(result.executionPath as string)).toBe(true);
    const execution = JSON.parse(
      readFileSync(result.executionPath as string, 'utf-8'),
    );
    expect(execution.transformationType).toBe('human-note');
    expect(execution.transformationVersion).toBe('1');
    expect(execution.sourceRefs[0]).toEqual({
      sourceGraphHash: HASH,
      conversationId: 'conv-1',
      nodeIds: ['n1'],
    });
    expect(execution.outputRefs).toEqual(result.derivedIds);
    const derived = JSON.parse(
      readFileSync((result.derivedPaths as string[])[0], 'utf-8'),
    );
    expect(derived.content).toBe(CONTENT);
    expect(derived.executionId).toBe(result.executionId);
    expect(derived.transformationVersion).toBe('derived-record/1');
    expect(existsSync(join(outputDir, 'chronicles'))).toBe(false);
    expect(existsSync(join(executionsDir, 'chronicles'))).toBe(false);
  });

  it('re-run of the same identity keeps createdAt', async () => {
    const first = await service.transform(baseInput(outputDir, executionsDir));
    const second = await service.transform({
      ...baseInput(outputDir, executionsDir),
      createdAt: '2026-08-18T00:00:00.000Z',
    });
    expect(second.status).toBe('already-present');
    expect(second.executionId).toBe(first.executionId);
    expect(second.createdAt).toBe(CREATED);
  });

  it('records two transformations from the same source', async () => {
    const note = await service.transform(baseInput(outputDir, executionsDir));
    const insight = await service.transform({
      ...baseInput(outputDir, executionsDir),
      transformationType: 'insight',
      content: 'SYNTHETIC_INSIGHT_NOTE',
    });
    expect(note.status).toBe('recorded');
    expect(insight.status).toBe('recorded');
    expect(insight.executionId).not.toBe(note.executionId);
    const walk = await service.provenance({
      executionsDir,
      sourceGraphHash: HASH,
    });
    expect(walk.status).toBe('ok');
    expect(walk.executionIds).toEqual(
      expect.arrayContaining([note.executionId, insight.executionId]),
    );
  });

  it('supports multiple derived records from one execution', async () => {
    const result = await service.transform({
      ...baseInput(outputDir, executionsDir),
      extraContents: ['SYNTHETIC_SECOND_NOTE'],
    });
    expect(result.status).toBe('recorded');
    expect(result.derivedIds).toHaveLength(2);
    const execution = JSON.parse(
      readFileSync(result.executionPath as string, 'utf-8'),
    );
    expect(execution.outputRefs).toEqual(result.derivedIds);
  });

  it('walks backward from a derived record and compares re-runs', async () => {
    const first = await service.transform(baseInput(outputDir, executionsDir));
    const second = await service.transform({
      ...baseInput(outputDir, executionsDir),
      content: 'SYNTHETIC_OTHER_NOTE',
      configuration: { tone: 'brief' },
    });
    const backward = await service.provenance({
      executionsDir,
      outputDir,
      derivedId: (first.derivedIds as string[])[0],
    });
    expect(backward.status).toBe('ok');
    expect(backward.executionId).toBe(first.executionId);
    expect(backward.sourceRefs).toEqual([
      {
        sourceGraphHash: HASH,
        conversationId: 'conv-1',
        nodeIds: ['n1'],
      },
    ]);
    const compared = await service.provenance({
      executionsDir,
      compareId: first.executionId,
      withId: second.executionId,
    });
    expect(compared.status).toBe('ok');
    expect(
      (compared.difference as { field: string }[]).map((row) => row.field),
    ).toEqual(['configuration', 'outputContentRefs']);
  });

  it('rejects an unknown recipe version and does not write Activity', async () => {
    const result = await service.transform({
      ...baseInput(outputDir, executionsDir),
      transformationVersion: '9',
    });
    expect(result.status).toBe('invalid');
    expect(result.error).toContain('unknown-transformation:human-note@9');
    expect(existsSync(join(outputDir, 'chronicles'))).toBe(false);
  });
});
