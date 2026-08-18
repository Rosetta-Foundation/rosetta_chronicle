import 'reflect-metadata';
import { Container } from 'inversify';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { InterpretSourceInput } from '../types';

const { CHRONICLE_TOKENS } = require('../tokens');
const {
  InterpretationService,
} = require('../services/interpretation.service');
const {
  ChatGptImportService,
} = require('../services/chatgpt-import.service');
const {
  ProvenanceService,
} = require('../services/provenance.service');
const {
  DerivedRecordStore,
} = require('../repositories/derived-record-store.repository');
const {
  ChatGptGraphStore,
} = require('../repositories/chatgpt-graph-store.repository');
const {
  ChatGptExportRepository,
} = require('../repositories/chatgpt-export.repository');
const {
  TransformationRegistry,
} = require('../repositories/transformation-registry.repository');
const {
  TransformationDefinitionStore,
} = require('../repositories/transformation-definition-store.repository');
const {
  TransformationExecutionStore,
} = require('../repositories/transformation-execution-store.repository');
const {
  ExecutionOccurrenceStore,
} = require('../repositories/execution-occurrence-store.repository');
const {
  SourceContentRepository,
} = require('../repositories/source-content.repository');

const FIXTURE = join(__dirname, 'fixtures/chatgpt-export/complete-export');
const CREATED = '2026-08-18T12:00:00.000Z';
const NONCE = 'aa'.repeat(16);
const LEAKS = [
  'REDACTED_SHOULD_NOT_LEAK',
  'SYNTHETIC_TITLE_MUST_NOT_LEAK',
  'REDACTED_FILENAME_MUST_NOT_LEAK',
];

const dumpDir = (dir: string): string => {
  if (!existsSync(dir)) return '';
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readFileSync(join(dir, name), 'utf-8'))
    .join('\n');
};

describe('InterpretationService', () => {
  let graphsDir: string;
  let outputDir: string;
  let executionsDir: string;
  let definitionsDir: string;
  let occurrencesDir: string;
  let hash: string;
  let graphPath: string;
  let interpret: {
    interpret: (input: InterpretSourceInput) => Promise<Record<string, unknown>>;
  };
  let provenance: {
    traverse: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  let model: { invoke: jest.Mock };

  const bind = (
    modelImpl: { invoke: jest.Mock },
    occurrenceStore: unknown = ExecutionOccurrenceStore,
  ) => {
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.ChatGptExportRepository)
      .to(ChatGptExportRepository);
    container.bind(CHRONICLE_TOKENS.ChatGptGraphStore).to(ChatGptGraphStore);
    container
      .bind(CHRONICLE_TOKENS.ChatGptImportService)
      .to(ChatGptImportService);
    container.bind(CHRONICLE_TOKENS.DerivedRecordStore).to(DerivedRecordStore);
    container
      .bind(CHRONICLE_TOKENS.TransformationRegistry)
      .to(TransformationRegistry);
    container
      .bind(CHRONICLE_TOKENS.TransformationDefinitionStore)
      .to(TransformationDefinitionStore);
    container
      .bind(CHRONICLE_TOKENS.TransformationExecutionStore)
      .to(TransformationExecutionStore);
    if (typeof occurrenceStore === 'function') {
      container
        .bind(CHRONICLE_TOKENS.ExecutionOccurrenceStore)
        .to(occurrenceStore as typeof ExecutionOccurrenceStore);
    } else {
      container
        .bind(CHRONICLE_TOKENS.ExecutionOccurrenceStore)
        .toConstantValue(occurrenceStore);
    }
    container
      .bind(CHRONICLE_TOKENS.SourceContentRepository)
      .to(SourceContentRepository);
    container
      .bind(CHRONICLE_TOKENS.ModelInvocationRepository)
      .toConstantValue(modelImpl);
    container
      .bind(CHRONICLE_TOKENS.InterpretationService)
      .to(InterpretationService);
    container.bind(CHRONICLE_TOKENS.ProvenanceService).to(ProvenanceService);
    interpret = container.get(CHRONICLE_TOKENS.InterpretationService);
    provenance = container.get(CHRONICLE_TOKENS.ProvenanceService);
  };

  beforeEach(async () => {
    graphsDir = mkdtempSync(join(tmpdir(), 'e4-graphs-'));
    outputDir = mkdtempSync(join(tmpdir(), 'e4-derived-'));
    executionsDir = mkdtempSync(join(tmpdir(), 'e4-exec-'));
    definitionsDir = mkdtempSync(join(tmpdir(), 'e4-def-'));
    occurrencesDir = mkdtempSync(join(tmpdir(), 'e4-occ-'));
    model = {
      invoke: jest.fn(),
    };
    bind(model);
    const importer = new ChatGptImportService(
      new ChatGptExportRepository(),
      new ChatGptGraphStore(),
    );
    const imported = await importer.importGraph(
      FIXTURE,
      graphsDir,
      CREATED,
      false,
    );
    hash = imported.contentHash as string;
    graphPath = imported.path as string;
  });
  afterEach(() => {
    rmSync(graphsDir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
    rmSync(executionsDir, { recursive: true, force: true });
    rmSync(definitionsDir, { recursive: true, force: true });
    rmSync(occurrencesDir, { recursive: true, force: true });
  });

  const base = (
    overrides: Partial<InterpretSourceInput> = {},
  ): InterpretSourceInput => ({
    exportPath: FIXTURE,
    graphPath,
    sourceGraphHash: hash,
    conversationId: 'conv-linear',
    nodeIds: ['node-linear-1', 'node-linear-2'],
    outputDir,
    executionsDir,
    definitionsDir,
    occurrencesDir,
    provider: 'fixture',
    model: 'synthetic-model',
    createdAt: CREATED,
    startedAt: CREATED,
    endedAt: CREATED,
    nonce: NONCE,
    ...overrides,
  });

  it('dry-run resolves refs and writes nothing', async () => {
    const result = await interpret.interpret(base({ dryRun: true }));
    expect(result.status).toBe('dry-run');
    expect(result.resolvedNodeCount).toBe(2);
    expect(result.definitionId).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(model.invoke).not.toHaveBeenCalled();
    expect(readdirSync(definitionsDir)).toEqual([]);
    expect(readdirSync(executionsDir)).toEqual([]);
    expect(readdirSync(outputDir)).toEqual([]);
    expect(readdirSync(occurrencesDir)).toEqual([]);
  });

  it('records unreviewed observations and walks provenance to source', async () => {
    model.invoke.mockResolvedValue({
      ok: true,
      text: JSON.stringify({
        result: 'observations',
        observations: [
          {
            statement: 'SYNTHETIC_DIRECT',
            epistemicClass: 'directly-supported',
            citedNodeIds: ['node-linear-1'],
          },
          {
            statement: 'SYNTHETIC_INFERRED',
            epistemicClass: 'inferred',
            citedNodeIds: ['node-linear-2'],
          },
        ],
      }),
      modelVersion: 'synthetic-model-2026-08-18',
    });
    const result = await interpret.interpret(base());
    expect(result.status).toBe('recorded');
    expect(result.reviewState).toBe('unreviewed');
    expect(result.outcome).toBe('observations');
    expect(result.providerStatus).toBe('succeeded');
    expect(result.persistenceStatus).toBe('committed');
    expect(result.epistemicClasses).toEqual([
      'directly-supported',
      'inferred',
    ]);
    expect(result.derivedIds).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_DIRECT');
    expect(model.invoke.mock.calls[0][0].prompt).toContain(
      'REDACTED_SHOULD_NOT_LEAK',
    );

    const dumped = [
      dumpDir(outputDir),
      dumpDir(executionsDir),
      dumpDir(definitionsDir),
      dumpDir(occurrencesDir),
    ].join('\n');
    for (const leak of LEAKS) {
      expect(dumped).not.toContain(leak);
    }
    expect(existsSync(join(outputDir, 'chronicles'))).toBe(false);

    const derivedIds = result.derivedIds as string[];
    const derived = JSON.parse(
      readFileSync(join(outputDir, `${derivedIds[0]}.json`), 'utf-8'),
    );
    expect(derived.reviewState).toBe('unreviewed');
    expect(derived.executionId).toBe(result.executionId);
    expect(derived.content).toContain('directly-supported');
    expect(derived.createdBy.promptVersion).toBeUndefined();

    const execution = JSON.parse(
      readFileSync(
        join(executionsDir, `${result.executionId}.json`),
        'utf-8',
      ),
    );
    expect(execution.deterministic).toBe(false);
    expect(execution.configuration.promptTemplateId).toBe(
      'candidate-observation/1',
    );
    expect(execution.configuration.reasoningEffort).toBeUndefined();

    const occurrence = JSON.parse(
      readFileSync(
        join(occurrencesDir, `${result.occurrenceId}.json`),
        'utf-8',
      ),
    );
    expect(occurrence.providerStatus).toBe('succeeded');
    expect(occurrence.persistenceStatus).toBe('committed');
    expect(occurrence.outcome).toBe('observations');
    expect(occurrence.modelVersion).toBe('synthetic-model-2026-08-18');
    expect(occurrence.producer.model).toBe('synthetic-model');
    expect(execution.configuration.modelVersion).toBeUndefined();

    const forward = await provenance.traverse({
      graphsDir,
      outputDir,
      executionsDir,
      definitionsDir,
      start: { kind: 'source-node', id: `${hash}:conv-linear:node-linear-1` },
      direction: 'forward',
    });
    expect(forward.status).toBe('ok');
    const kinds = (forward.nodes as { kind: string }[]).map((n) => n.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'source-node',
        'transformation-execution',
        'derived-record',
      ]),
    );
    const backward = await provenance.traverse({
      graphsDir,
      outputDir,
      executionsDir,
      definitionsDir,
      start: {
        kind: 'derived-record',
        id: (result.derivedIds as string[])[0],
      },
      direction: 'backward',
    });
    expect(backward.status).toBe('ok');
    expect(
      (backward.nodes as { kind: string }[]).map((n) => n.kind),
    ).toEqual(
      expect.arrayContaining([
        'derived-record',
        'transformation-execution',
        'transformation-definition',
        'source-node',
      ]),
    );
  });

  it('records xAI reasoningEffort on the occurrence configuration', async () => {
    model.invoke.mockResolvedValue({
      ok: true,
      text: JSON.stringify({
        result: 'insufficient-evidence',
        citedNodeIds: ['node-linear-1'],
      }),
    });
    const result = await interpret.interpret(
      base({ provider: 'xAI', model: 'grok-4.6' }),
    );
    expect(result.status).toBe('recorded');
    expect(model.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'xAI',
        model: 'grok-4.6',
      }),
    );
    const occurrence = JSON.parse(
      readFileSync(
        join(occurrencesDir, `${result.occurrenceId}.json`),
        'utf-8',
      ),
    );
    expect(occurrence.producer.model).toBe('grok-4.6');
    expect(occurrence.configuration.provider).toBe('xAI');
    expect(occurrence.configuration.reasoningEffort).toBe('high');
    const execution = JSON.parse(
      readFileSync(
        join(executionsDir, `${result.executionId}.json`),
        'utf-8',
      ),
    );
    expect(execution.configuration.reasoningEffort).toBe('high');
  });

  it('persists insufficient-evidence as epistemic success', async () => {
    model.invoke.mockResolvedValue({
      ok: true,
      text: JSON.stringify({
        result: 'insufficient-evidence',
        citedNodeIds: ['node-mm-1'],
        supportNote: 'SYNTHETIC_MISSING_ATTACHMENT',
      }),
    });
    const result = await interpret.interpret(
      base({
        conversationId: 'conv-multimodal',
        nodeIds: ['node-mm-1'],
      }),
    );
    expect(result.status).toBe('recorded');
    expect(result.outcome).toBe('insufficient-evidence');
    expect(result.providerStatus).toBe('succeeded');
    expect(result.persistenceStatus).toBe('committed');
    expect(result.derivedIds).toHaveLength(1);
    const derivedId = (result.derivedIds as string[])[0];
    const derived = JSON.parse(
      readFileSync(join(outputDir, `${derivedId}.json`), 'utf-8'),
    );
    expect(JSON.parse(derived.content).result).toBe('insufficient-evidence');
  });

  it('does not persist derived records when the model output is malformed', async () => {
    model.invoke.mockResolvedValue({ ok: true, text: 'not-json' });
    const result = await interpret.interpret(base());
    expect(result.status).toBe('invalid-output');
    expect(result.providerStatus).toBe('failed');
    expect(result.persistenceStatus).toBe('not-committed');
    expect(readdirSync(outputDir)).toEqual([]);
    expect(readdirSync(executionsDir)).toEqual([]);
    expect(readdirSync(occurrencesDir)).toHaveLength(1);
  });

  it('does not call the model when a cited node is missing', async () => {
    const result = await interpret.interpret(
      base({ nodeIds: ['node-linear-1', 'no-such-node'] }),
    );
    expect(result.status).toBe('invalid');
    expect(result.error).toContain('node-missing');
    expect(model.invoke).not.toHaveBeenCalled();
    expect(readdirSync(occurrencesDir)).toEqual([]);
  });

  it('records provider unavailability without executions or derived files', async () => {
    model.invoke.mockResolvedValue({
      ok: false,
      failureClass: 'unavailable',
    });
    const result = await interpret.interpret(base());
    expect(result.status).toBe('unavailable');
    expect(result.providerStatus).toBe('failed');
    expect(result.providerFailureClass).toBe('unavailable');
    expect(result.persistenceStatus).toBe('not-committed');
    expect(result.outcome).toBeUndefined();
    expect(readdirSync(outputDir)).toEqual([]);
    expect(readdirSync(executionsDir)).toEqual([]);
    expect(readdirSync(occurrencesDir)).toHaveLength(1);
    expect(readdirSync(definitionsDir)).toHaveLength(1);
  });

  it('collapses identical retries into one execution and a new occurrence', async () => {
    const text = JSON.stringify({
      result: 'observations',
      observations: [
        {
          statement: 'SYNTHETIC_DIRECT',
          epistemicClass: 'directly-supported',
          citedNodeIds: ['node-linear-1'],
        },
      ],
    });
    model.invoke.mockResolvedValue({ ok: true, text });
    const first = await interpret.interpret(base());
    const second = await interpret.interpret(base({ nonce: 'bb'.repeat(16) }));
    expect(first.status).toBe('recorded');
    expect(second.status).toBe('already-present');
    expect(second.executionId).toBe(first.executionId);
    expect(second.occurrenceId).not.toBe(first.occurrenceId);
    expect(readdirSync(executionsDir)).toHaveLength(1);
    expect(readdirSync(occurrencesDir)).toHaveLength(2);
  });

  it('defaults startedAt at the provider call, not request createdAt', async () => {
    model.invoke.mockImplementation(async () => ({
      ok: true,
      text: JSON.stringify({
        result: 'observations',
        observations: [
          {
            statement: 'SYNTHETIC_DIRECT',
            epistemicClass: 'directly-supported',
            citedNodeIds: ['node-linear-1'],
          },
        ],
      }),
    }));
    const input = base();
    delete input.startedAt;
    delete input.nonce;
    const result = await interpret.interpret(input);
    expect(result.status).toBe('recorded');
    const occurrenceId = result.occurrenceId as string;
    const occurrence = JSON.parse(
      readFileSync(join(occurrencesDir, `${occurrenceId}.json`), 'utf-8'),
    );
    expect(occurrence.startedAt).not.toBe(CREATED);
    expect(occurrence.startedAt).toEqual(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
    expect(occurrence.nonce).toEqual(expect.stringMatching(/^[a-f0-9]{32}$/));
  });

  it('keeps persistence committed when occurrence write fails after record', async () => {
    model.invoke.mockResolvedValue({
      ok: true,
      text: JSON.stringify({
        result: 'observations',
        observations: [
          {
            statement: 'SYNTHETIC_DIRECT',
            epistemicClass: 'directly-supported',
            citedNodeIds: ['node-linear-1'],
          },
        ],
      }),
    });
    bind(model, {
      read: async () => null,
      write: async () => {
        throw new Error('disk-full');
      },
      pathFor: (dir: string, id: string) => join(dir, `${id}.json`),
    });
    const result = await interpret.interpret(base());
    expect(result.status).toBe('occurrence-persist-failed');
    expect(result.providerStatus).toBe('succeeded');
    expect(result.persistenceStatus).toBe('committed');
    expect(result.executionId).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(result.derivedIds).toHaveLength(1);
    expect(result.occurrenceId).toBeUndefined();
    expect(readdirSync(executionsDir)).toHaveLength(1);
    expect(readdirSync(outputDir)).toHaveLength(1);
    expect(readdirSync(occurrencesDir)).toEqual([]);
  });

  it('keeps persistence committed when occurrence write fails after already-present', async () => {
    const text = JSON.stringify({
      result: 'observations',
      observations: [
        {
          statement: 'SYNTHETIC_DIRECT',
          epistemicClass: 'directly-supported',
          citedNodeIds: ['node-linear-1'],
        },
      ],
    });
    model.invoke.mockResolvedValue({ ok: true, text });
    const first = await interpret.interpret(base());
    expect(first.status).toBe('recorded');
    bind(model, {
      read: async () => null,
      write: async () => {
        throw new Error('disk-full');
      },
      pathFor: (dir: string, id: string) => join(dir, `${id}.json`),
    });
    const second = await interpret.interpret(base({ nonce: 'bb'.repeat(16) }));
    expect(second.status).toBe('occurrence-persist-failed');
    expect(second.providerStatus).toBe('succeeded');
    expect(second.persistenceStatus).toBe('committed');
    expect(second.executionId).toBe(first.executionId);
    expect(second.derivedIds).toEqual(first.derivedIds);
    expect(second.occurrenceId).toBeUndefined();
    expect(readdirSync(occurrencesDir)).toHaveLength(1);
  });

  it('says the receipt failed when unavailable and occurrence write fails', async () => {
    model.invoke.mockResolvedValue({
      ok: false,
      failureClass: 'unavailable',
    });
    bind(model, {
      read: async () => null,
      write: async () => {
        throw new Error('disk-full');
      },
      pathFor: (dir: string, id: string) => join(dir, `${id}.json`),
    });
    const result = await interpret.interpret(base());
    expect(result.status).toBe('occurrence-persist-failed');
    expect(result.error).toBe('occurrence-persist-failed');
    expect(result.providerStatus).toBe('failed');
    expect(result.providerFailureClass).toBe('unavailable');
    expect(result.persistenceStatus).toBe('not-committed');
    expect(result.occurrenceId).toBeUndefined();
    expect(result.executionId).toBeUndefined();
    expect(result.derivedIds).toBeUndefined();
    expect(readdirSync(executionsDir)).toEqual([]);
    expect(readdirSync(outputDir)).toEqual([]);
    expect(readdirSync(occurrencesDir)).toEqual([]);
  });

  it('says the receipt failed when timeout is uncertain and occurrence write fails', async () => {
    model.invoke.mockResolvedValue({
      ok: false,
      failureClass: 'timeout',
    });
    bind(model, {
      read: async () => null,
      write: async () => {
        throw new Error('disk-full');
      },
      pathFor: (dir: string, id: string) => join(dir, `${id}.json`),
    });
    const result = await interpret.interpret(base());
    expect(result.status).toBe('occurrence-persist-failed');
    expect(result.error).toBe('occurrence-persist-failed');
    expect(result.providerStatus).toBe('uncertain');
    expect(result.providerFailureClass).toBe('timeout');
    expect(result.persistenceStatus).toBe('not-committed');
    expect(result.occurrenceId).toBeUndefined();
    expect(readdirSync(executionsDir)).toEqual([]);
    expect(readdirSync(outputDir)).toEqual([]);
    expect(readdirSync(occurrencesDir)).toEqual([]);
  });

  it('writes execution before derived and leaves no orphan on derived persist failure', async () => {
    model.invoke.mockResolvedValue({
      ok: true,
      text: JSON.stringify({
        result: 'observations',
        observations: [
          {
            statement: 'SYNTHETIC_DIRECT',
            epistemicClass: 'directly-supported',
            citedNodeIds: ['node-linear-1'],
          },
        ],
      }),
    });
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.ChatGptExportRepository)
      .to(ChatGptExportRepository);
    container.bind(CHRONICLE_TOKENS.ChatGptGraphStore).to(ChatGptGraphStore);
    container.bind(CHRONICLE_TOKENS.DerivedRecordStore).toConstantValue({
      read: async () => null,
      write: async () => {
        throw new Error('disk-full');
      },
      pathFor: (dir: string, id: string) => join(dir, `${id}.json`),
    });
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
      .bind(CHRONICLE_TOKENS.ExecutionOccurrenceStore)
      .to(ExecutionOccurrenceStore);
    container
      .bind(CHRONICLE_TOKENS.SourceContentRepository)
      .to(SourceContentRepository);
    container
      .bind(CHRONICLE_TOKENS.ModelInvocationRepository)
      .toConstantValue(model);
    container
      .bind(CHRONICLE_TOKENS.InterpretationService)
      .to(InterpretationService);
    const failing = container.get(CHRONICLE_TOKENS.InterpretationService) as {
      interpret: (input: InterpretSourceInput) => Promise<Record<string, unknown>>;
    };
    const result = await failing.interpret(base());
    expect(result.status).toBe('persist-failed');
    expect(result.providerStatus).toBe('succeeded');
    expect(result.persistenceStatus).toBe('not-committed');
    expect(readdirSync(executionsDir)).toHaveLength(1);
    expect(readdirSync(outputDir)).toEqual([]);
    expect(readdirSync(occurrencesDir)).toHaveLength(1);
    const occurrence = JSON.parse(
      readFileSync(
        join(occurrencesDir, readdirSync(occurrencesDir)[0]),
        'utf-8',
      ),
    );
    expect(occurrence.executionId).toBeUndefined();
    expect(occurrence.derivedIds).toBeUndefined();
  });
});
