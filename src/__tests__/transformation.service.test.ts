import 'reflect-metadata';
import { Container } from 'inversify';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
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
const {
  TransformationDefinitionStore,
} = require('../repositories/transformation-definition-store.repository');

const HASH = 'b'.repeat(64);
const CREATED = '2026-08-17T21:00:00.000Z';
const CONTENT = 'SYNTHETIC_DERIVED_NOTE';

const baseInput = (
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
  content: CONTENT,
  createdAt: CREATED,
});

describe('TransformationService', () => {
  let outputDir: string;
  let executionsDir: string;
  let definitionsDir: string;
  let service: {
    transform: (
      input: TransformRecordInput,
    ) => Promise<Record<string, unknown>>;
    provenance: (query: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'derived-xform-'));
    executionsDir = mkdtempSync(join(tmpdir(), 'exec-xform-'));
    definitionsDir = mkdtempSync(join(tmpdir(), 'def-xform-'));
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.DerivedRecordStore)
      .to(DerivedRecordStore);
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
    container
      .bind(CHRONICLE_TOKENS.TransformationService)
      .to(TransformationService);
    service = container.get(CHRONICLE_TOKENS.TransformationService);
  });
  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
    rmSync(executionsDir, { recursive: true, force: true });
    rmSync(definitionsDir, { recursive: true, force: true });
  });

  it('persists an execution and derived record without Activity', async () => {
    const result = await service.transform(baseInput(outputDir, executionsDir, definitionsDir));
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
    expect(execution.definitionId).toBe(result.definitionId);
    expect(existsSync(result.definitionPath as string)).toBe(true);
    const definition = JSON.parse(
      readFileSync(result.definitionPath as string, 'utf-8'),
    );
    expect(definition.type).toBe('human-note');
    expect(definition.version).toBe('1');
    expect(definition.id).toBe(definition.contentHash);
    expect(JSON.stringify(definition)).not.toContain(CONTENT);
    expect(JSON.stringify(definition)).not.toMatch(
      /"source"\s*:\s*"chatgpt-export"/,
    );
    const derived = JSON.parse(
      readFileSync((result.derivedPaths as string[])[0], 'utf-8'),
    );
    expect(derived.content).toBe(CONTENT);
    expect(derived.executionId).toBe(result.executionId);
    expect(derived.transformationVersion).toBe('derived-record/1');
    expect(existsSync(join(outputDir, 'chronicles'))).toBe(false);
    expect(existsSync(join(executionsDir, 'chronicles'))).toBe(false);
    expect(existsSync(join(definitionsDir, 'chronicles'))).toBe(false);
  });

  it('re-run of the same identity keeps createdAt', async () => {
    const first = await service.transform(baseInput(outputDir, executionsDir, definitionsDir));
    const second = await service.transform({
      ...baseInput(outputDir, executionsDir, definitionsDir),
      createdAt: '2026-08-18T00:00:00.000Z',
    });
    expect(second.status).toBe('already-present');
    expect(second.executionId).toBe(first.executionId);
    expect(second.createdAt).toBe(CREATED);
  });

  it('records two transformations from the same source', async () => {
    const note = await service.transform(baseInput(outputDir, executionsDir, definitionsDir));
    const insight = await service.transform({
      ...baseInput(outputDir, executionsDir, definitionsDir),
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
      ...baseInput(outputDir, executionsDir, definitionsDir),
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
    const first = await service.transform(baseInput(outputDir, executionsDir, definitionsDir));
    const second = await service.transform({
      ...baseInput(outputDir, executionsDir, definitionsDir),
      content: 'SYNTHETIC_OTHER_NOTE',
      configuration: { tone: 'brief' },
    });
    const backward = await service.provenance({
      executionsDir,
      definitionsDir,
      outputDir,
      derivedId: (first.derivedIds as string[])[0],
    });
    expect(backward.status).toBe('ok');
    expect(backward.executionId).toBe(first.executionId);
    expect(backward.definitionId).toBe(first.definitionId);
    expect(backward.definition).toEqual(
      expect.objectContaining({
        type: 'human-note',
        version: '1',
        id: first.definitionId,
      }),
    );
    const fromDef = await service.provenance({
      executionsDir,
      definitionsDir,
      definitionId: first.definitionId,
    });
    expect(fromDef.status).toBe('ok');
    expect(fromDef.executionIds).toEqual(
      expect.arrayContaining([first.executionId, second.executionId]),
    );
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

  it('fails honestly when a cited definition is missing or invalid', async () => {
    const recorded = await service.transform(
      baseInput(outputDir, executionsDir, definitionsDir),
    );
    const defPath = recorded.definitionPath as string;
    const derivedId = (recorded.derivedIds as string[])[0];

    rmSync(defPath);
    const missingExec = await service.provenance({
      executionsDir,
      definitionsDir,
      executionId: recorded.executionId,
    });
    expect(missingExec.status).toBe('not-found');
    expect(missingExec.error).toBe('definition-missing');
    expect(missingExec.executionId).toBe(recorded.executionId);
    expect(missingExec.definitionId).toBe(recorded.definitionId);
    expect(existsSync(join(outputDir, 'chronicles'))).toBe(false);

    const missingDerived = await service.provenance({
      executionsDir,
      definitionsDir,
      outputDir,
      derivedId,
    });
    expect(missingDerived.status).toBe('not-found');
    expect(missingDerived.error).toBe('definition-missing');

    const fromDef = await service.provenance({
      executionsDir,
      definitionsDir,
      definitionId: recorded.definitionId,
    });
    expect(fromDef.status).toBe('not-found');
    expect(fromDef.error).toBe('definition-missing');
    expect(fromDef.executionIds).toEqual([recorded.executionId]);

    writeFileSync(
      defPath,
      JSON.stringify({
        id: recorded.definitionId,
        type: 'human-note',
        version: '1',
        description: 'tampered recipe text',
        deterministic: true,
        allowedProducerTypes: ['human', 'agent'],
        createdAt: CREATED,
        contentHash: recorded.definitionId,
      }),
    );
    const invalid = await service.provenance({
      executionsDir,
      definitionsDir,
      executionId: recorded.executionId,
    });
    expect(invalid.status).toBe('not-found');
    expect(invalid.error).toBe('definition-invalid');

    const noDir = await service.provenance({
      executionsDir,
      executionId: recorded.executionId,
    });
    expect(noDir.status).toBe('invalid');
    expect(noDir.error).toBe('definitions-dir-required');
  });

  it('rejects an unknown recipe version and does not write Activity', async () => {
    const result = await service.transform({
      ...baseInput(outputDir, executionsDir, definitionsDir),
      transformationVersion: '9',
    });
    expect(result.status).toBe('invalid');
    expect(result.error).toContain('unknown-transformation:human-note@9');
    expect(existsSync(join(outputDir, 'chronicles'))).toBe(false);
  });

  it('rejects candidate-observation; that type is interpret-source only', async () => {
    const result = await service.transform({
      ...baseInput(outputDir, executionsDir, definitionsDir),
      transformationType: 'candidate-observation',
      createdBy: { type: 'agent', name: 'chronicle-interpret', model: 'x' },
    });
    expect(result.status).toBe('invalid');
    expect(result.error).toContain(
      'machine-type-not-caller-supplied:candidate-observation',
    );
    expect(existsSync(join(outputDir, 'chronicles'))).toBe(false);
  });
});
