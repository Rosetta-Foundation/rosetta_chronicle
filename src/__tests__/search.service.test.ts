import 'reflect-metadata';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Container } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import { ObserveService } from '../services/observe.service';
import { SearchService } from '../services/search.service';
import { SourceVaultRepository } from '../repositories/source-vault.repository';
import { ObserveConfigRepository } from '../repositories/observe-config.repository';
import { ObservationReceiptRepository } from '../repositories/observation-receipt.repository';
import { LexicalSearchResult } from '../types';

const shard = (
  conversationId: string,
  nodes: { id: string; role: string; text: string; parent?: string }[],
): unknown[] => [
  {
    conversation_id: conversationId,
    current_node: nodes[0]?.id,
    mapping: Object.fromEntries(
      nodes.map((node) => [
        node.id,
        {
          id: node.id,
          parent: node.parent ?? null,
          message: {
            author: { role: node.role },
            create_time: 1700000000,
            content: { content_type: 'text', parts: [node.text] },
          },
        },
      ]),
    ),
  },
];

describe('SearchService', () => {
  let dataDir: string;
  let observe: ObserveService;
  let search: SearchService;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'search-v0-'));
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.SourceVaultRepository)
      .to(SourceVaultRepository);
    container
      .bind(CHRONICLE_TOKENS.ObserveConfigRepository)
      .to(ObserveConfigRepository);
    container
      .bind(CHRONICLE_TOKENS.ObservationReceiptRepository)
      .to(ObservationReceiptRepository);
    container.bind(CHRONICLE_TOKENS.ObserveService).to(ObserveService);
    container.bind(CHRONICLE_TOKENS.SearchService).to(SearchService);
    observe = container.get(CHRONICLE_TOKENS.ObserveService);
    search = container.get(CHRONICLE_TOKENS.SearchService);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  const observeShard = async (
    scopeId: string,
    fileName: string,
    body: unknown,
  ): Promise<void> => {
    const dir = join(dataDir, scopeId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, fileName), `${JSON.stringify(body)}\n`);
    await observe.handle({
      op: 'init',
      dataDir,
      scopeId,
      filePath: dir,
    });
    await observe.handle({ op: 'observe', dataDir, scopeId });
  };

  it('returns exact-term hits with evidence coordinates', async () => {
    await observeShard(
      'live',
      'conversations-000.json',
      shard('conv-exact', [
        { id: 'n1', role: 'user', text: 'The path is the data tonight.' },
      ]),
    );
    const result = await search.search({
      dataDir,
      query: 'path is the data',
      limit: 20,
      snippetChars: 80,
    });
    expect(result.status).toBe('ok');
    expect(result.branchPolicy).toBe('all-mapping-nodes');
    expect(result.hitCount).toBe(1);
    expect(result.hits[0]?.conversationId).toBe('conv-exact');
    expect(result.hits[0]?.nodeId).toBe('n1');
    expect(result.hits[0]?.scopeId).toBe('live');
    expect(result.hits[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.hits[0]?.snippet.toLowerCase()).toContain('path is the data');
    expect(result.matchMode).toBe('raw');
    expect(result.normalizedQuery).toBeUndefined();
    expect(typeof result.elapsedMs).toBe('number');
  });

  it('does not treat a paraphrase as an exact lexical hit', async () => {
    await observeShard(
      'live',
      'conversations-000.json',
      shard('conv-para', [
        {
          id: 'n1',
          role: 'user',
          text: 'I wish I had kept every raw draft of that message.',
        },
      ]),
    );
    const result = await search.search({
      dataDir,
      query: 'Personal Chronicle as trajectory',
      limit: 20,
      snippetChars: 80,
    });
    expect(result.status).toBe('ok');
    expect(result.hitCount).toBe(0);
  });

  it('omits forgotten scopes and still finds live ones', async () => {
    await observeShard(
      'secret',
      'conversations-000.json',
      shard('conv-secret', [
        { id: 'n1', role: 'user', text: 'FORGOTTEN_TOKEN lives here' },
      ]),
    );
    await observeShard(
      'live',
      'conversations-000.json',
      shard('conv-live', [
        { id: 'n1', role: 'user', text: 'LIVE_TOKEN lives here' },
      ]),
    );
    await observe.handle({
      op: 'forget-scope',
      dataDir,
      scopeId: 'secret',
    });
    const forgotten = await search.search({
      dataDir,
      query: 'FORGOTTEN_TOKEN',
      limit: 20,
      snippetChars: 80,
    });
    expect(forgotten.hitCount).toBe(0);
    expect(forgotten.scopesSkippedForgotten).toBe(1);
    const live = await search.search({
      dataDir,
      query: 'LIVE_TOKEN',
      limit: 20,
      snippetChars: 80,
    });
    expect(live.hitCount).toBe(1);
    expect(live.hits[0]?.conversationId).toBe('conv-live');
  });

  it('reports ambiguous common-term hits without collapsing them', async () => {
    await observeShard(
      'live',
      'conversations-000.json',
      shard('conv-amb', [
        { id: 'n1', role: 'user', text: 'provider path on disk' },
        {
          id: 'n2',
          role: 'assistant',
          text: 'a practice of the paths',
          parent: 'n1',
        },
      ]),
    );
    const result = await search.search({
      dataDir,
      query: 'path',
      limit: 20,
      snippetChars: 80,
    });
    expect(result.hitCount).toBe(2);
  });

  it('searches off-current-path branch nodes', async () => {
    await observeShard(
      'live',
      'conversations-000.json',
      shard('conv-branch', [
        { id: 'n-current', role: 'user', text: 'CURRENT_BRANCH' },
        { id: 'n-other', role: 'assistant', text: 'SIBLING_BRANCH' },
      ]),
    );
    const result = await search.search({
      dataDir,
      query: 'SIBLING_BRANCH',
      limit: 20,
      snippetChars: 40,
    });
    expect(result.hitCount).toBe(1);
    expect(result.hits[0]?.nodeId).toBe('n-other');
  });

  it('rejects an empty query and missing config', async () => {
    const empty = await search.search({
      dataDir,
      query: '   ',
      limit: 20,
      snippetChars: 80,
    });
    expect(empty.status).toBe('invalid');
    const missing = await search.search({
      dataDir: join(dataDir, 'no-such'),
      query: 'x',
      limit: 20,
      snippetChars: 80,
    });
    expect(missing.status).toBe('no-config');
  });

  it('ignores non-conversation allowlisted files', async () => {
    const dir = join(dataDir, 'mixed');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'notes.txt'), 'SECRET_NOTE\n');
    writeFileSync(
      join(dir, 'conversations-000.json'),
      `${JSON.stringify(
        shard('conv-ok', [
          { id: 'n1', role: 'user', text: 'VISIBLE_NOTE' },
        ]),
      )}\n`,
    );
    await observe.handle({
      op: 'init',
      dataDir,
      scopeId: 'mixed',
      filePath: dir,
    });
    await observe.handle({ op: 'observe', dataDir, scopeId: 'mixed' });
    const hidden = await search.search({
      dataDir,
      query: 'SECRET_NOTE',
      limit: 20,
      snippetChars: 80,
    });
    expect(hidden.hitCount).toBe(0);
    const visible = await search.search({
      dataDir,
      query: 'VISIBLE_NOTE',
      limit: 20,
      snippetChars: 80,
    });
    expect(visible.hitCount).toBe(1);
  });

  it('keeps raw misses that normalized can hit', async () => {
    await observeShard(
      'live',
      'conversations-000.json',
      shard('conv-norm', [
        {
          id: 'n-md',
          role: 'user',
          text: 'the **path** is the data tonight',
        },
      ]),
    );
    const rawSpace = await search.search({
      dataDir,
      query: 'path is the data',
      matchMode: 'raw',
      limit: 20,
      snippetChars: 80,
    });
    expect(rawSpace.hitCount).toBe(0);
    expect(rawSpace.matchMode).toBe('raw');
    const normalized = await search.search({
      dataDir,
      query: 'path is  the data',
      matchMode: 'normalized',
      limit: 20,
      snippetChars: 80,
    });
    expect(normalized.hitCount).toBe(1);
    expect(normalized.matchMode).toBe('normalized');
    expect(normalized.normalizedQuery).toBe('path is the data');
    expect(normalized.hits[0]?.nodeId).toBe('n-md');
    const punct = await search.search({
      dataDir,
      query: 'path is the data,',
      matchMode: 'normalized',
      limit: 20,
      snippetChars: 80,
    });
    expect(punct.hitCount).toBe(0);
    const paraphrase = await search.search({
      dataDir,
      query: 'Personal Chronicle as trajectory',
      matchMode: 'normalized',
      limit: 20,
      snippetChars: 80,
    });
    expect(paraphrase.hitCount).toBe(0);
  });

  it('filters hits by vendor role without changing the matcher', async () => {
    await observeShard(
      'live',
      'conversations-000.json',
      shard('conv-roles', [
        { id: 'n-user', role: 'user', text: 'practice of the paths tonight' },
        {
          id: 'n-asst',
          role: 'assistant',
          text: 'practice of the paths as a reply',
          parent: 'n-user',
        },
      ]),
    );
    const users = await search.search({
      dataDir,
      query: 'practice of the paths',
      role: 'user',
      limit: 20,
      snippetChars: 80,
    });
    expect(users.hitCount).toBe(1);
    expect(users.hits[0]?.nodeId).toBe('n-user');
    const assistants = await search.search({
      dataDir,
      query: 'practice of the paths',
      role: 'assistant',
      limit: 20,
      snippetChars: 80,
    });
    expect(assistants.hitCount).toBe(1);
    expect(assistants.hits[0]?.nodeId).toBe('n-asst');
  });

  it('returns a typed result shape for latency measurement', async () => {
    await observeShard(
      'live',
      'conversations-000.json',
      shard('conv-t', [{ id: 'n1', role: 'user', text: 'timer' }]),
    );
    const result: LexicalSearchResult = await search.search({
      dataDir,
      query: 'timer',
      limit: 1,
      snippetChars: 20,
    });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.shardsScanned).toBe(1);
    expect(result.nodesScanned).toBeGreaterThanOrEqual(1);
  });
});
