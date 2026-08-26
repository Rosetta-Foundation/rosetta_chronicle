import 'reflect-metadata';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Container } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import { ObserveService } from '../services/observe.service';
import { SourceVaultRepository } from '../repositories/source-vault.repository';
import { ObserveConfigRepository } from '../repositories/observe-config.repository';
import { ObservationReceiptRepository } from '../repositories/observation-receipt.repository';

describe('ObserveService', () => {
  let dataDir: string;
  let source: string;
  let service: {
    handle: (cmd: unknown) => Promise<unknown>;
  };

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'observe-v1-'));
    source = join(dataDir, 'source.jsonl');
    writeFileSync(source, '{"id":"synth","body":"STATE_A"}\n');
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
    service = container.get(CHRONICLE_TOKENS.ObserveService);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('stores then deduplicates then stores a new state', async () => {
    await service.handle({
      op: 'init',
      dataDir,
      scopeId: 'synth-1',
      filePath: source,
    });
    const first = (await service.handle({
      op: 'observe',
      dataDir,
      scopeId: 'synth-1',
      capturedAt: '2026-08-26T00:00:00.000Z',
    })) as { status: string; receipt: { contentHash: string } };
    expect(first.status).toBe('stored');
    const again = (await service.handle({
      op: 'observe',
      dataDir,
      scopeId: 'synth-1',
    })) as { status: string };
    expect(again.status).toBe('duplicate');
    writeFileSync(source, '{"id":"synth","body":"STATE_B"}\n');
    const second = (await service.handle({
      op: 'observe',
      dataDir,
      scopeId: 'synth-1',
    })) as { status: string; receipt: { contentHash: string } };
    expect(second.status).toBe('stored');
    expect(second.receipt.contentHash).not.toBe(first.receipt.contentHash);
    const status = (await service.handle({
      op: 'status',
      dataDir,
    })) as { objectCount: number };
    expect(status.objectCount).toBe(2);
    const out = join(dataDir, 'resolved-a');
    const resolved = (await service.handle({
      op: 'resolve',
      dataDir,
      contentHash: first.receipt.contentHash,
      outputPath: out,
    })) as { ok: boolean };
    expect(resolved.ok).toBe(true);
    expect(readFileSync(out, 'utf8')).toContain('STATE_A');
  });

  it('watch-once observes allowlisted scopes', async () => {
    await service.handle({
      op: 'init',
      dataDir,
      scopeId: 'synth-1',
      filePath: source,
    });
    const results = (await service.handle({
      op: 'watch-once',
      dataDir,
    })) as { status: string }[];
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('stored');
  });

  it('STOP skips observe; forget-scope deletes our copy and refuses later', async () => {
    await service.handle({
      op: 'init',
      dataDir,
      scopeId: 'synth-1',
      filePath: source,
    });
    await service.handle({ op: 'observe', dataDir, scopeId: 'synth-1' });
    await service.handle({ op: 'stop', dataDir, scopeId: 'synth-1' });
    const skipped = (await service.handle({
      op: 'observe',
      dataDir,
      scopeId: 'synth-1',
    })) as { status: string };
    expect(skipped.status).toBe('skipped-stopped');
    await service.handle({ op: 'resume', dataDir, scopeId: 'synth-1' });
    const forgotten = (await service.handle({
      op: 'forget-scope',
      dataDir,
      scopeId: 'synth-1',
    })) as { deletedObjects: number };
    expect(forgotten.deletedObjects).toBe(1);
    const after = (await service.handle({
      op: 'observe',
      dataDir,
      scopeId: 'synth-1',
    })) as { status: string };
    expect(after.status).toBe('skipped-forgotten');
    const status = (await service.handle({
      op: 'status',
      dataDir,
    })) as { objectCount: number };
    expect(status.objectCount).toBe(0);
  });
});
