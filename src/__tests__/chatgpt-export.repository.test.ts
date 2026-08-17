import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ChatGptExportRepository } from '../repositories/chatgpt-export.repository';

const FIXTURE = join(
  __dirname,
  'fixtures/chatgpt-export/complete-export',
);
const INVALID = join(
  __dirname,
  'fixtures/chatgpt-export/invalid-export',
);

const LEAKS = [
  'REDACTED_SHOULD_NOT_LEAK',
  'SYNTHETIC_TITLE_MUST_NOT_LEAK',
  'REDACTED_EMAIL_MUST_NOT_LEAK',
  'REDACTED_FILENAME_MUST_NOT_LEAK',
];

describe('ChatGptExportRepository.read', () => {
  const repo = new ChatGptExportRepository();

  it('returns missing when the path does not exist', async () => {
    const result = await repo.read('/tmp/chatgpt-export-does-not-exist');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing');
  });

  it('returns invalid when the path is not a directory or zip', async () => {
    const result = await repo.read(__filename);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });

  it('strips source text from a directory export', async () => {
    const result = await repo.read(FIXTURE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dumped = JSON.stringify(result.export);
    for (const leak of LEAKS) {
      expect(dumped).not.toContain(leak);
    }
    expect(result.export.kind).toBe('directory');
    expect(result.export.shardNames).toEqual([
      'conversations-000.json',
      'conversations-001.json',
    ]);
    expect(result.export.conversations.length).toBeGreaterThan(0);
    expect(
      result.export.conversations.some((c) =>
        c.malformedReasons.includes('conversation-not-object'),
      ),
    ).toBe(true);
  });

  it('records invalid JSON shards without throwing', async () => {
    const result = await repo.read(INVALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.export.unsupported).toEqual(
      expect.arrayContaining([
        { reason: 'invalid-json:conversations-000.json' },
      ]),
    );
  });

  it('reads a zip without extracting attachment blobs into the result', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'chatgpt-export-zip-'));
    const zipPath = join(tmp, 'export.zip');
    execFileSync('zip', ['-q', '-r', zipPath, '.'], { cwd: FIXTURE });
    try {
      const result = await repo.read(zipPath);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.export.kind).toBe('archive');
      expect(result.export.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(result.export)).not.toContain(
        'REDACTED_SHOULD_NOT_LEAK',
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
