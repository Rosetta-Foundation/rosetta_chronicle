import 'reflect-metadata';
import { Container } from 'inversify';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { CHRONICLE_TOKENS } = require('../tokens');
const {
  ChatGptImportService,
} = require('../services/chatgpt-import.service');
const {
  ChatGptExportRepository,
} = require('../repositories/chatgpt-export.repository');
const {
  ChatGptGraphStore,
} = require('../repositories/chatgpt-graph-store.repository');

const FIXTURE = join(__dirname, 'fixtures/chatgpt-export/complete-export');
const IMPORTED = '2026-08-17T21:00:00.000Z';
const LATER = '2026-08-18T00:00:00.000Z';

const LEAKS = [
  'REDACTED_SHOULD_NOT_LEAK',
  'SYNTHETIC_TITLE_MUST_NOT_LEAK',
  'REDACTED_EMAIL_MUST_NOT_LEAK',
  'REDACTED_FILENAME_MUST_NOT_LEAK',
];

describe('ChatGptImportService', () => {
  let repoDir: string;
  let service: {
    importGraph: (
      exportPath: string,
      repoPath: string,
      importedAt: string,
      dryRun: boolean,
    ) => Promise<Record<string, unknown>>;
  };

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'chatgpt-import-'));
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.ChatGptExportRepository)
      .to(ChatGptExportRepository);
    container.bind(CHRONICLE_TOKENS.ChatGptGraphStore).to(ChatGptGraphStore);
    container
      .bind(CHRONICLE_TOKENS.ChatGptImportService)
      .to(ChatGptImportService);
    service = container.get(CHRONICLE_TOKENS.ChatGptImportService);
  });
  afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

  it('persists a stripped graph from the synthetic fixture', async () => {
    const result = await service.importGraph(FIXTURE, repoDir, IMPORTED, false);
    expect(result.status).toBe('imported');
    expect(result.importedAt).toBe(IMPORTED);
    expect(result.conversationCount).toBe(9);
    expect(typeof result.contentHash).toBe('string');
    expect(result.path).toBe(
      join(
        repoDir,
        'chronicles',
        '.data',
        'chatgpt-export',
        `${result.contentHash}.json`,
      ),
    );

    const dumped = readFileSync(result.path as string, 'utf-8');
    for (const leak of LEAKS) {
      expect(dumped).not.toContain(leak);
    }
    expect(dumped).not.toMatch(/"source"\s*:\s*"chatgpt-export"/);
    const dailyMd = join(
      repoDir,
      'chronicles',
      `${IMPORTED.slice(0, 10)}.md`,
    );
    expect(existsSync(dailyMd)).toBe(false);
    expect(readdirSync(join(repoDir, 'chronicles', '.data'))).toEqual([
      'chatgpt-export',
    ]);

    const graph = JSON.parse(dumped);
    const byId = Object.fromEntries(
      graph.conversations.map((c: { sourceId: string }) => [c.sourceId, c]),
    );
    const parentRoot = byId['conv-parent-branch'].nodes.find(
      (n: { id: string }) => n.id === 'node-branch-root',
    );
    expect(parentRoot.sourceChildIds).toEqual([]);
    expect(parentRoot.reconstructedChildIds).toEqual(
      expect.arrayContaining(['node-branch-a', 'node-branch-b']),
    );
    const explicitRoot = byId['conv-explicit-children'].nodes.find(
      (n: { id: string }) => n.id === 'node-ex-root',
    );
    expect(explicitRoot.sourceChildIds).toEqual(['node-ex-a', 'node-ex-b']);
    expect(explicitRoot.reconstructedChildIds).toEqual(['node-ex-a', 'node-ex-b']);

    const mm = byId['conv-multimodal'].nodes.find(
      (n: { id: string }) => n.id === 'node-mm-1',
    );
    expect(mm.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'file-fixture-present',
          presentInArchive: true,
        }),
        expect.objectContaining({
          id: 'file-fixture-absent',
          presentInArchive: false,
        }),
      ]),
    );
    expect(graph.unsupported.map((u: { reason: string }) => u.reason)).toContain(
      'attachment-missing-from-archive',
    );
  });

  it('re-import of the same hash is a no-op and keeps importedAt', async () => {
    const first = await service.importGraph(FIXTURE, repoDir, IMPORTED, false);
    const second = await service.importGraph(FIXTURE, repoDir, LATER, false);
    expect(second.status).toBe('already-present');
    expect(second.importedAt).toBe(IMPORTED);
    expect(second.contentHash).toBe(first.contentHash);
    const graph = JSON.parse(readFileSync(first.path as string, 'utf-8'));
    expect(graph.archive.importedAt).toBe(IMPORTED);
  });

  it('dry-run builds the result without writing', async () => {
    const result = await service.importGraph(FIXTURE, repoDir, IMPORTED, true);
    expect(result.status).toBe('imported');
    expect(result.conversationCount).toBe(9);
    expect(existsSync(result.path as string)).toBe(false);
  });

  it('returns missing without writing', async () => {
    const result = await service.importGraph(
      '/tmp/no-such-chatgpt-export',
      repoDir,
      IMPORTED,
      false,
    );
    expect(result.status).toBe('missing');
    expect(result.conversationCount).toBe(0);
    expect(existsSync(join(repoDir, 'chronicles'))).toBe(false);
  });
});
