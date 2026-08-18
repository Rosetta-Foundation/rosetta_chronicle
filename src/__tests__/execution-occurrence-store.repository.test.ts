import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { ExecutionOccurrenceStore } from '../repositories/execution-occurrence-store.repository';
import { ExecutionOccurrence } from '../types';

const occurrence = (
  overrides: Partial<ExecutionOccurrence> = {},
): ExecutionOccurrence => ({
  id: 'a'.repeat(64),
  definitionId: 'b'.repeat(64),
  sourceRefs: [{ sourceGraphHash: 'c'.repeat(64), nodeIds: ['n1'] }],
  producer: { type: 'agent', name: 'chronicle-interpret', model: 'm' },
  configuration: { provider: 'fixture' },
  startedAt: '2026-08-18T12:00:00.000Z',
  endedAt: '2026-08-18T12:00:01.000Z',
  nonce: 'aa'.repeat(16),
  providerStatus: 'succeeded',
  persistenceStatus: 'committed',
  outcome: 'observations',
  ...overrides,
});

describe('ExecutionOccurrenceStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'occ-store-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes once and treats an identical rewrite as already-present', async () => {
    const store = new ExecutionOccurrenceStore();
    const record = occurrence();
    const written = await store.write(dir, record);
    expect(written).toBe(path.join(dir, `${record.id}.json`));
    expect(await store.read(dir, record.id)).toEqual(record);
    const first = readFileSync(written, 'utf-8');
    await store.write(dir, { ...record });
    expect(readFileSync(written, 'utf-8')).toBe(first);
  });

  it('refuses to overwrite a different receipt under the same id', async () => {
    const store = new ExecutionOccurrenceStore();
    const record = occurrence();
    const written = await store.write(dir, record);
    const first = readFileSync(written, 'utf-8');
    await expect(
      store.write(
        dir,
        occurrence({ persistenceStatus: 'not-committed' }),
      ),
    ).rejects.toThrow('occurrence-conflict:immutable');
    expect(readFileSync(written, 'utf-8')).toBe(first);
  });

  it('refuses to replace an unreadable existing file', async () => {
    const store = new ExecutionOccurrenceStore();
    const record = occurrence();
    writeFileSync(path.join(dir, `${record.id}.json`), '{not-json');
    await expect(store.write(dir, record)).rejects.toThrow(
      'occurrence-conflict:unreadable',
    );
  });
});
