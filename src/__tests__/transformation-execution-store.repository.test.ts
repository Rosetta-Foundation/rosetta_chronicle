import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { TransformationExecutionStore } from '../repositories/transformation-execution-store.repository';
import { TransformationExecution } from '../types';

const execution = (): TransformationExecution => ({
  id: 'c'.repeat(64),
  definitionId: 'b'.repeat(64),
  transformationType: 'human-note',
  transformationVersion: '1',
  sourceRefs: [{ sourceGraphHash: 'a'.repeat(64), nodeIds: [] }],
  producer: { type: 'human', name: 'fixture' },
  createdAt: '2026-08-17T21:00:00.000Z',
  configuration: {},
  deterministic: true,
  outputRefs: ['d'.repeat(64)],
  outputContentRefs: ['e'.repeat(64)],
});

describe('TransformationExecutionStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'exec-store-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes and reads an execution', async () => {
    const store = new TransformationExecutionStore();
    const record = execution();
    const written = await store.write(dir, record);
    expect(written).toBe(path.join(dir, `${record.id}.json`));
    expect(await store.read(dir, record.id)).toEqual(record);
  });

  it('lists executions and skips derived-record shaped files', async () => {
    const store = new TransformationExecutionStore();
    await store.write(dir, execution());
    writeFileSync(
      path.join(dir, `${'f'.repeat(64)}.json`),
      JSON.stringify({
        id: 'f'.repeat(64),
        contentRef: 'e'.repeat(64),
        reviewState: 'recognized',
        createdBy: { type: 'human', name: 'fixture' },
      }),
    );
    const listed = await store.list(dir);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe('c'.repeat(64));
  });
});
