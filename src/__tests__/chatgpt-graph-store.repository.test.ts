import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { ChatGptGraphStore } from '../repositories/chatgpt-graph-store.repository';
import { ChatGptSourceGraph } from '../types';

const HASH = 'a'.repeat(64);

const graph = (importedAt: string): ChatGptSourceGraph => ({
  archive: {
    contentHash: HASH,
    kind: 'directory',
    importedAt,
    shardNames: ['conversations-000.json'],
    sidecarFiles: ['user.json'],
  },
  conversations: [
    {
      sourceId: 'c1',
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
          contentType: 'text',
          attachments: [],
        },
      ],
    },
  ],
  unsupported: [],
});

describe('ChatGptGraphStore', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(path.join(tmpdir(), 'chatgpt-graph-store-'));
  });
  afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

  it('read returns null when no graph exists', async () => {
    const store = new ChatGptGraphStore();
    expect(await store.read(repoDir, HASH)).toBeNull();
  });

  it('round-trips a graph as <outputDir>/<hash>.json with no extra layout', async () => {
    const store = new ChatGptGraphStore();
    const written = await store.write(repoDir, graph('2026-08-17T21:00:00.000Z'));
    const expected = path.join(repoDir, `${HASH}.json`);
    expect(written).toBe(expected);
    expect(existsSync(expected)).toBe(true);
    expect(
      existsSync(path.join(repoDir, 'chronicles', '.data', 'chatgpt-export')),
    ).toBe(false);
    const read = await store.read(repoDir, HASH);
    expect(read?.archive.importedAt).toBe('2026-08-17T21:00:00.000Z');
    expect(read?.conversations[0].sourceId).toBe('c1');
    expect(readFileSync(expected, 'utf-8')).not.toContain(
      'REDACTED_SHOULD_NOT_LEAK',
    );
    expect((await store.readAt(expected))?.archive.contentHash).toBe(HASH);
    expect(await store.readAt(path.join(repoDir, 'missing.json'))).toBeNull();
  });

  it('rejects a non-hex content hash so the path cannot escape', async () => {
    const store = new ChatGptGraphStore();
    await expect(
      store.write(repoDir, {
        ...graph('2026-08-17T21:00:00.000Z'),
        archive: {
          ...graph('2026-08-17T21:00:00.000Z').archive,
          contentHash: '../escape',
        },
      }),
    ).rejects.toThrow(/invalid content hash/);
    expect(await store.read(repoDir, '../escape')).toBeNull();
  });

  it('listResolved reports a corrupt sibling as a failure', async () => {
    const store = new ChatGptGraphStore();
    await store.write(repoDir, graph('2026-08-17T21:00:00.000Z'));
    const bad = 'b'.repeat(64);
    writeFileSync(path.join(repoDir, `${bad}.json`), '{not-json');
    writeFileSync(path.join(repoDir, 'notes.txt'), 'ignore');
    writeFileSync(path.join(repoDir, 'not-a-hash.json'), '{"archive":{}}');
    const inventory = await store.listResolved(repoDir);
    expect(inventory.present).toBe(true);
    expect(inventory.records).toHaveLength(1);
    expect(inventory.records[0].archive.contentHash).toBe(HASH);
    expect(inventory.failures.map((row) => row.filename).sort()).toEqual([
      `${bad}.json`,
      'not-a-hash.json',
    ]);
  });

  it('listResolved marks a missing directory as absent', async () => {
    const store = new ChatGptGraphStore();
    const inventory = await store.listResolved(
      path.join(repoDir, 'missing-graphs'),
    );
    expect(inventory).toEqual({ present: false, records: [], failures: [] });
  });
});
