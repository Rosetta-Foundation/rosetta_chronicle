import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { GitRepository } from '../repositories/git.repository';

const git = (cwd: string, args: string[]): void => {
  execFileSync('git', ['-C', cwd, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
};

describe('GitRepository.getActivity (real git)', () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(path.join(tmpdir(), 'chronicle-git-'));
    git(repoDir, ['init', '-q']);
    git(repoDir, ['config', 'user.email', 'test@example.com']);
    git(repoDir, ['config', 'user.name', 'Test User']);
    git(repoDir, ['config', 'commit.gpgsign', 'false']);
    // A subject with a comma and pipe to prove delimiter safety.
    git(repoDir, ['commit', '--allow-empty', '-m', 'feat: add adapter, with pipe | char']);
    git(repoDir, ['commit', '--allow-empty', '-m', 'fix: correct parsing']);
  });

  afterAll(() => rmSync(repoDir, { recursive: true, force: true }));

  it('maps commits in the window to Activity records with evidence', async () => {
    const repo = new GitRepository();
    const activities = await repo.getActivity(repoDir, {
      start: '2000-01-01',
      end: '2030-01-01',
    });

    expect(activities).toHaveLength(2);
    const summaries = activities.map((a) => a.summary);
    expect(summaries).toContain('feat: add adapter, with pipe | char');
    expect(summaries).toContain('fix: correct parsing');

    const first = activities[0];
    expect(first.source).toBe('git');
    expect(first.evidence).toHaveLength(1);
    expect(first.evidence[0].ref).toBe(first.id);
    expect(first.evidence[0].description).toContain(first.id.slice(0, 8));
  });

  it('returns [] for a window with no commits', async () => {
    const repo = new GitRepository();
    const activities = await repo.getActivity(repoDir, {
      start: '1990-01-01',
      end: '1990-01-02',
    });
    expect(activities).toEqual([]);
  });

  it('returns [] for a non-git path instead of throwing', async () => {
    const repo = new GitRepository();
    const activities = await repo.getActivity('/nonexistent/path/xyz', {
      start: '2000-01-01',
      end: '2030-01-01',
    });
    expect(activities).toEqual([]);
  });

  it('attributes each commit to its repository slug (directory basename)', async () => {
    const repo = new GitRepository();
    const activities = await repo.getActivity(repoDir, {
      start: '2000-01-01',
      end: '2030-01-01',
    });
    const slug = path.basename(repoDir);
    expect(activities.every((a) => a.repo === slug)).toBe(true);
  });

  it('excludes merge commits by default', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'chronicle-merges-'));
    mkdirSync(workspace, { recursive: true });
    git(workspace, ['init', '-b', 'main', '-q']);
    git(workspace, ['config', 'user.email', 'test@example.com']);
    git(workspace, ['config', 'user.name', 'Test User']);
    git(workspace, ['config', 'commit.gpgsign', 'false']);
    git(workspace, ['commit', '--allow-empty', '-m', 'feat: real commit']);
    git(workspace, ['checkout', '-b', 'side-branch', '-q']);
    git(workspace, ['commit', '--allow-empty', '-m', 'chore: branch commit']);
    git(workspace, ['checkout', 'main', '-q']);
    git(workspace, ['merge', '--no-ff', 'side-branch', '-m', 'Merge pull request #1']);

    const repo = new GitRepository();
    const activities = await repo.getActivity(workspace, {
      start: '2000-01-01',
      end: '2030-01-01',
    });

    rmSync(workspace, { recursive: true, force: true });

    const summaries = activities.map((a) => a.summary);
    expect(summaries).not.toContain('Merge pull request #1');
    expect(summaries).toContain('feat: real commit');
    expect(summaries).toContain('chore: branch commit');
  });

  it('includes merge commits when includeMerges is true', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'chronicle-merges-inc-'));
    mkdirSync(workspace, { recursive: true });
    git(workspace, ['init', '-b', 'main', '-q']);
    git(workspace, ['config', 'user.email', 'test@example.com']);
    git(workspace, ['config', 'user.name', 'Test User']);
    git(workspace, ['config', 'commit.gpgsign', 'false']);
    git(workspace, ['commit', '--allow-empty', '-m', 'feat: real commit']);
    git(workspace, ['checkout', '-b', 'side-branch', '-q']);
    git(workspace, ['commit', '--allow-empty', '-m', 'chore: branch commit']);
    git(workspace, ['checkout', 'main', '-q']);
    git(workspace, ['merge', '--no-ff', 'side-branch', '-m', 'Merge pull request #1']);

    const repo = new GitRepository();
    const activities = await repo.getActivity(
      workspace,
      { start: '2000-01-01', end: '2030-01-01' },
      true, // includeMerges
    );

    rmSync(workspace, { recursive: true, force: true });

    const summaries = activities.map((a) => a.summary);
    expect(summaries).toContain('Merge pull request #1');
  });
});
