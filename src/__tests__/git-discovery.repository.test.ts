import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { GitDiscoveryRepository } from '../repositories/git-discovery.repository';

/** Create a directory with a `.git` marker subdir to look like a repo. */
const makeRepo = (dir: string): void => {
  mkdirSync(path.join(dir, '.git'), { recursive: true });
};

describe('GitDiscoveryRepository.discover', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'chronicle-discovery-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns [] for a nonexistent root', async () => {
    const repo = new GitDiscoveryRepository();
    expect(await repo.discover(path.join(root, 'nope'))).toEqual([]);
  });

  it('finds repos at the top level and nested', async () => {
    makeRepo(path.join(root, 'repo-a'));
    makeRepo(path.join(root, 'nested', 'repo-b'));

    const repo = new GitDiscoveryRepository();
    const found = await repo.discover(root);

    expect(found).toContain(path.join(root, 'repo-a'));
    expect(found).toContain(path.join(root, 'nested', 'repo-b'));
    expect(found).toHaveLength(2);
  });

  it('returns results sorted for deterministic output', async () => {
    makeRepo(path.join(root, 'zeta'));
    makeRepo(path.join(root, 'alpha'));

    const repo = new GitDiscoveryRepository();
    const found = await repo.discover(root);

    expect(found).toEqual([...found].sort());
  });

  it('does not descend into a repo once found (treats nested checkout as one)', async () => {
    makeRepo(path.join(root, 'outer'));
    makeRepo(path.join(root, 'outer', 'inner'));

    const repo = new GitDiscoveryRepository();
    const found = await repo.discover(root);

    expect(found).toEqual([path.join(root, 'outer')]);
  });

  it('respects maxDepth', async () => {
    makeRepo(path.join(root, 'a', 'b', 'c', 'deep-repo'));

    const repo = new GitDiscoveryRepository();
    const shallow = await repo.discover(root, { maxDepth: 2 });
    expect(shallow).toEqual([]);

    const deep = await repo.discover(root, { maxDepth: 5 });
    expect(deep).toContain(path.join(root, 'a', 'b', 'c', 'deep-repo'));
  });

  it('skips ignored directory names', async () => {
    makeRepo(path.join(root, 'node_modules', 'pkg'));
    makeRepo(path.join(root, 'real-repo'));

    const repo = new GitDiscoveryRepository();
    const found = await repo.discover(root);

    expect(found).toEqual([path.join(root, 'real-repo')]);
  });

  it('honors a custom ignore list', async () => {
    makeRepo(path.join(root, 'skip-me', 'repo'));
    makeRepo(path.join(root, 'keep', 'repo'));

    const repo = new GitDiscoveryRepository();
    const found = await repo.discover(root, { ignore: ['skip-me'] });

    expect(found).toContain(path.join(root, 'keep', 'repo'));
    expect(found).not.toContain(path.join(root, 'skip-me', 'repo'));
  });
});
