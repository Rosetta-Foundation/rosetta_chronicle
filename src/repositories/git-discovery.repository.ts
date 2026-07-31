import { readdirSync, existsSync } from 'fs';
import path from 'path';
import { injectable } from 'inversify';
import { DiscoveryOptions } from '../types';

/**
 * Source adapter for discovering git repositories under a root directory.
 * Resource access only — no business logic.
 *
 * Walks the filesystem breadth-first from a root, returning the absolute path
 * of every directory that contains a `.git` entry. The walk is bounded by a max
 * depth and skips an ignore-list of directory names (e.g. `node_modules`) so it
 * stays fast on large trees. A repository is not descended into once found —
 * nested checkouts below an outermost `.git` are treated as part of that repo.
 */
export interface IGitDiscoveryRepository {
  /**
   * Return the absolute paths of all git repositories found under `root`.
   *
   * @param root - Absolute path of the directory to walk.
   * @param opts - Optional bounds: `maxDepth` and `ignore` directory names.
   *   `includeMerges` is ignored here (it belongs to git querying, not
   *   discovery) but is accepted so callers can pass one options object through.
   * @returns Sorted absolute repository paths; empty if `root` is missing or
   *   contains no repositories.
   */
  discover(root: string, opts?: DiscoveryOptions): Promise<string[]>;
}

/** Directory names never worth descending into when hunting for repos. */
const DEFAULT_IGNORE = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
];

/** Default maximum depth of the walk below the root. */
const DEFAULT_MAX_DEPTH = 4;

/**
 * Filesystem implementation of {@link IGitDiscoveryRepository}.
 *
 * Uses an iterative breadth-first walk (an explicit queue rather than
 * recursion, so a pathological directory tree cannot overflow the call stack).
 * A directory containing a `.git` entry is recorded and not descended into, so a
 * nested checkout below an outermost repo is folded into that repo. The
 * ignore-list and `maxDepth` bound the walk; unreadable directories are skipped
 * rather than thrown, so discovery never fails the whole Chronicle. Results are
 * sorted for deterministic output.
 */
@injectable()
export class GitDiscoveryRepository implements IGitDiscoveryRepository {
  /** @inheritDoc */
  async discover(root: string, opts?: DiscoveryOptions): Promise<string[]> {
    const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_DEPTH;
    const ignore = new Set(opts?.ignore ?? DEFAULT_IGNORE);

    const found: string[] = [];
    // Iterative BFS so a pathological tree cannot blow the call stack.
    const queue: Array<{ dir: string; depth: number }> = [
      { dir: root, depth: 0 },
    ];

    while (queue.length > 0) {
      const { dir, depth } = queue.shift() as { dir: string; depth: number };

      if (existsSync(path.join(dir, '.git'))) {
        // Outermost repo found — record it and do not descend further.
        found.push(dir);
        continue;
      }

      if (depth >= maxDepth) continue;

      let entries: import('fs').Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        // Unreadable directory (permissions, race) — skip rather than fail.
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (ignore.has(entry.name)) continue;
        queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
      }
    }

    return found.sort();
  }
}
