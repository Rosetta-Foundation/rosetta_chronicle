import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { TransformationDefinitionStore } from '../repositories/transformation-definition-store.repository';
import { TransformationDefinition } from '../types';
import { buildTransformationDefinition } from '../utils/transformation.utils';

const recipe = {
  type: 'human-note' as const,
  version: '1',
  description: 'Caller-supplied note citing source-graph structure.',
  deterministic: true,
  allowedProducerTypes: ['human' as const, 'agent' as const],
};

const definition = (): TransformationDefinition =>
  buildTransformationDefinition(recipe, '2026-08-17T21:00:00.000Z');

describe('TransformationDefinitionStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'def-store-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes, reads, and lists a definition', async () => {
    const store = new TransformationDefinitionStore();
    const record = definition();
    const written = await store.write(dir, record);
    expect(written).toBe(path.join(dir, `${record.id}.json`));
    expect(await store.read(dir, record.id)).toEqual(record);
    const listed = await store.list(dir);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(record.id);
  });

  it('rejects an invalid definition and skips a hash-mismatched file', async () => {
    const store = new TransformationDefinitionStore();
    const record = definition();
    await expect(
      store.write(dir, { ...record, contentHash: 'd'.repeat(64) }),
    ).rejects.toThrow('definition-hash-mismatch');
    writeFileSync(
      path.join(dir, `${record.id}.json`),
      JSON.stringify({ ...record, contentHash: 'd'.repeat(64) }),
    );
    expect(await store.read(dir, record.id)).toBeNull();
    expect(await store.list(dir)).toEqual([]);
  });
});
