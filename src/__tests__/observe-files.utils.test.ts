import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { listAllowlistedFiles } from '../utils/observe-files.utils';

describe('listAllowlistedFiles', () => {
  it('lists nested files and not parents', () => {
    const root = mkdtempSync(join(tmpdir(), 'allowlist-'));
    try {
      mkdirSync(join(root, 'nested'));
      writeFileSync(join(root, 'a.json'), '1');
      writeFileSync(join(root, 'nested', 'b.json'), '2');
      const files = listAllowlistedFiles(root);
      expect(files.map((f) => basename(f)).sort()).toEqual([
        'a.json',
        'b.json',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips symlinks that escape the allowlisted root', () => {
    const root = mkdtempSync(join(tmpdir(), 'allowlist-in-'));
    const outside = mkdtempSync(join(tmpdir(), 'allowlist-out-'));
    try {
      writeFileSync(join(outside, 'secret.txt'), 'nope');
      writeFileSync(join(root, 'ok.txt'), 'yes');
      symlinkSync(join(outside, 'secret.txt'), join(root, 'escape'));
      const files = listAllowlistedFiles(root);
      expect(files.map((f) => basename(f))).toEqual(['ok.txt']);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
