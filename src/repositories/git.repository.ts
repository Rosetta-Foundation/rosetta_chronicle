import { execFileSync } from 'child_process';
import path from 'path';
import { injectable } from 'inversify';
import { Activity, ChronicleWindow } from '../types';

/**
 * Source adapter for Git activity. Resource access only — no business logic.
 *
 * Queries a single repository's `git log` for the window and maps each commit to
 * an Activity attributed to that repo. Discovering *which* repositories to query
 * under a workspace root is the job of `GitDiscoveryRepository`; aggregating
 * across repos is the service's job. This repository stays single-repo.
 */
export interface IGitRepository {
  /**
   * Collect commit activity in the given window for a single repository.
   * When `includeMerges` is false (default), merge commits are excluded.
   */
  getActivity(
    repoPath: string,
    window: ChronicleWindow,
    includeMerges?: boolean,
  ): Promise<Activity[]>;
}

// ASCII control chars as delimiters — safe because they never appear in commit
// metadata, so subjects with commas/pipes/quotes parse cleanly.
const UNIT = '\x1f'; // between fields of one commit
const RECORD = '\x1e'; // between commits

/**
 * Git implementation of {@link IGitRepository}.
 *
 * Shells out to `git log` for a single repository over the window, using ASCII
 * unit/record separators in the pretty-format so commit subjects containing
 * commas, pipes, or quotes parse unambiguously. Each commit maps to one
 * {@link Activity} attributed to the repo's directory basename. A failed
 * invocation (bad path, not a repo, no history) yields `[]` rather than throwing,
 * so one unreadable repo never fails an aggregated multi-repo Chronicle.
 */
@injectable()
export class GitRepository implements IGitRepository {
  /** @inheritDoc */
  async getActivity(
    repoPath: string,
    window: ChronicleWindow,
    includeMerges = false,
  ): Promise<Activity[]> {
    const repoSlug = path.basename(repoPath);
    const format = ['%H', '%aI', '%s', '%an'].join(UNIT) + RECORD;

    const args = [
      '-C',
      repoPath,
      'log',
      `--since=${window.start} 00:00:00`,
      `--until=${window.end} 23:59:59`,
    ];
    // Merge filtering is configurable — never hardcoded.
    if (!includeMerges) args.push('--no-merges');
    args.push(`--pretty=format:${format}`);

    let raw: string;
    try {
      raw = execFileSync('git', args, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // Not a git repo, bad path, or no history — contribute nothing rather
      // than failing the whole Chronicle.
      return [];
    }

    return raw
      .split(RECORD)
      .map((r) => r.trim())
      .filter((r) => r.length > 0)
      .map((record) => {
        const [sha, timestamp, subject, author] = record.split(UNIT);
        const shortSha = sha.slice(0, 8);
        return {
          source: 'git',
          id: sha,
          timestamp,
          summary: subject,
          repo: repoSlug,
          evidence: [
            {
              source: 'git',
              ref: sha,
              description: `${shortSha} ${subject} (${author})`,
            },
          ],
        } satisfies Activity;
      });
  }
}
