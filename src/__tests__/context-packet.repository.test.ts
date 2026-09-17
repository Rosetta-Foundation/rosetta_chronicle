import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ObserveConfigRepository,
  isObserveConfigShape,
} from '../repositories/observe-config.repository';
import { ObservationReceiptRepository } from '../repositories/observation-receipt.repository';
import {
  SourceVaultRepository,
  sha256Bytes,
} from '../repositories/source-vault.repository';

describe('diagnostic observe config', () => {
  let dir: string;
  const repo = new ObserveConfigRepository();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reports missing, unreadable, and invalid-shape configs', async () => {
    const missing = await repo.readResolved(dir);
    expect(missing.ok).toBe(false);
    writeFileSync(join(dir, 'config.json'), '{not json');
    const unread = await repo.readResolved(dir);
    expect(unread.ok).toBe(false);
    if (!unread.ok) expect(unread.reason).toBe('unreadable');
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ version: 1 }));
    const shaped = await repo.readResolved(dir);
    expect(shaped.ok).toBe(false);
    if (!shaped.ok) expect(shaped.reason).toBe('invalid-shape');
    expect(
      isObserveConfigShape({ version: 1, stopped: false, scopes: [] }),
    ).toBe(true);
  });
});

describe('diagnostic receipts', () => {
  let dir: string;
  const repo = new ObservationReceiptRepository();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rcp-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('counts malformed JSON that list() would skip', async () => {
    const receipts = join(dir, 'receipts');
    const { mkdirSync } = await import('fs');
    mkdirSync(receipts, { recursive: true });
    writeFileSync(join(receipts, 'bad.json'), '{');
    writeFileSync(
      join(receipts, 'ok.json'),
      JSON.stringify({
        observationId: 'o1',
        scopeId: 's',
        sourceKind: 'file',
        sourcePath: 'conversations-000.json',
        capturedAt: '2026-01-01T00:00:00.000Z',
        contentHash: 'a'.repeat(64),
        bytes: 1,
        clockClass: 'meta',
        duplicate: false,
      }),
    );
    const listed = await repo.list(dir);
    const resolved = await repo.listResolved(dir, 4096);
    expect(listed).toHaveLength(1);
    expect(resolved.invalid).toBe(1);
    expect(resolved.receipts).toHaveLength(1);
  });
});

describe('verified vault reads', () => {
  let dir: string;
  const repo = new SourceVaultRepository();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vlt-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('recomputes the hash and rejects oversize objects without a full mismatch miss', async () => {
    const bytes = Buffer.from('hello-vault');
    const hash = sha256Bytes(bytes);
    await repo.putIfNew(dir, hash, bytes);
    const ok = await repo.getVerified(dir, hash, 1024);
    expect(ok.ok).toBe(true);
    const oversize = await repo.getVerified(dir, hash, 4);
    expect(oversize.ok).toBe(false);
    if (!oversize.ok) expect(oversize.reason).toBe('oversize');
    const path = repo.objectPath(dir, hash);
    writeFileSync(path, Buffer.from('tampered-bytes'));
    const mismatch = await repo.getVerified(dir, hash, 1024);
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.reason).toBe('hash-mismatch');
  });
});
