import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SourceContentRepository } from '../repositories/source-content.repository';
import { ChatGptImportService } from '../services/chatgpt-import.service';
import { ChatGptExportRepository } from '../repositories/chatgpt-export.repository';
import { ChatGptGraphStore } from '../repositories/chatgpt-graph-store.repository';

const FIXTURE = join(
  __dirname,
  'fixtures/chatgpt-export/complete-export',
);
const IMPORTED = '2026-08-17T21:00:00.000Z';

describe('SourceContentRepository', () => {
  let graphsDir: string;
  const repo = new SourceContentRepository();
  const importService = new ChatGptImportService(
    new ChatGptExportRepository(),
    new ChatGptGraphStore(),
  );
  const graphStore = new ChatGptGraphStore();

  beforeEach(() => {
    graphsDir = mkdtempSync(join(tmpdir(), 'src-content-graph-'));
  });
  afterEach(() => {
    rmSync(graphsDir, { recursive: true, force: true });
  });

  it('resolves cited node text without inventing missing attachments', async () => {
    const imported = await importService.importGraph(
      FIXTURE,
      graphsDir,
      IMPORTED,
      false,
    );
    const graph = await graphStore.read(
      graphsDir,
      imported.contentHash as string,
    );
    expect(graph).not.toBeNull();
    const resolved = await repo.resolve({
      exportPath: FIXTURE,
      sourceGraphHash: imported.contentHash as string,
      conversationId: 'conv-linear',
      nodeIds: ['node-linear-1'],
      graph: graph!,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.nodes[0]?.text).toContain('REDACTED_SHOULD_NOT_LEAK');

    const multimodal = await repo.resolve({
      exportPath: FIXTURE,
      sourceGraphHash: imported.contentHash as string,
      conversationId: 'conv-multimodal',
      nodeIds: ['node-mm-1'],
      graph: graph!,
    });
    expect(multimodal.ok).toBe(true);
    if (!multimodal.ok) return;
    expect(
      multimodal.nodes[0]?.attachments.some(
        (item) => item.id === 'file-fixture-absent' && !item.presentInArchive,
      ),
    ).toBe(true);
    expect(JSON.stringify(multimodal.nodes)).not.toContain(
      'REDACTED_FILENAME_MUST_NOT_LEAK',
    );
  });

  it('fails when the export hash does not match the cited graph', async () => {
    const imported = await importService.importGraph(
      FIXTURE,
      graphsDir,
      IMPORTED,
      false,
    );
    const graph = await graphStore.read(
      graphsDir,
      imported.contentHash as string,
    );
    const result = await repo.resolve({
      exportPath: FIXTURE,
      sourceGraphHash: 'a'.repeat(64),
      conversationId: 'conv-linear',
      nodeIds: ['node-linear-1'],
      graph: graph!,
    });
    expect(result).toEqual({
      ok: false,
      error: 'source-content-hash-mismatch',
    });
  });
});
