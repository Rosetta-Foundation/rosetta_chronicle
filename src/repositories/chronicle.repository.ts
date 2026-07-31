import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { injectable } from 'inversify';
import { DailyChronicle, PersistedChronicle } from '../types';
import {
  dailyLedgerCommitSubject,
  dailyLedgerCommitTrailers,
} from '../utils/commit.utils';

// Engine version for the Generated-By trailer, resolved from this package's
// manifest (…/dist/repositories → …/package.json; same shape under src in jest).
const ENGINE_VERSION = (
  JSON.parse(
    readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'),
  ) as { version: string }
).version;

/**
 * Persistence adapter for generated Chronicles. Resource access only — writes
 * the Markdown to the personal Chronicle repository and commits it. No business
 * logic.
 */
export interface IChronicleRepository {
  /** Write `chronicle` into `repoPath` and commit it. */
  persistDaily(
    repoPath: string,
    chronicle: DailyChronicle,
  ): Promise<PersistedChronicle>;
  /** Read the raw Markdown of an existing Chronicle for `date` (YYYY-MM-DD), or null if absent. */
  readDaily(repoPath: string, date: string): Promise<string | null>;
}

const CHRONICLES_DIR = 'chronicles';

/**
 * Filesystem-and-git implementation of {@link IChronicleRepository}.
 *
 * Reads and writes the day's Markdown under `<repoPath>/chronicles/<date>.md`,
 * creating the directory as needed. Persistence then best-effort stages and
 * commits the file: if git is unavailable, the path is not a repo, or nothing
 * changed on a re-run, the file is still written and `committed: false` is
 * reported rather than throwing — so a Chronicle is never lost to a git hiccup.
 */
@injectable()
export class ChronicleRepository implements IChronicleRepository {
  /** @inheritDoc */
  async readDaily(repoPath: string, date: string): Promise<string | null> {
    const absPath = path.join(repoPath, CHRONICLES_DIR, `${date}.md`);
    if (!existsSync(absPath)) return null;
    return readFileSync(absPath, 'utf-8');
  }

  /** @inheritDoc */
  async persistDaily(
    repoPath: string,
    chronicle: DailyChronicle,
  ): Promise<PersistedChronicle> {
    // v0.1 covers a single day; the file is named for the window start.
    const fileName = `${chronicle.window.start}.md`;
    const relPath = path.join(CHRONICLES_DIR, fileName);
    const absDir = path.join(repoPath, CHRONICLES_DIR);
    const absPath = path.join(absDir, fileName);

    mkdirSync(absDir, { recursive: true });
    writeFileSync(absPath, chronicle.markdown);

    // Commit the render together with its sibling artifacts for the day: the
    // structured sidecar (source of truth) and the authoritative notes file,
    // both written by the handler before this call. Only paths that exist are
    // staged, so a day without notes still commits cleanly.
    const date = chronicle.window.start;
    const relPaths = [
      relPath,
      path.join(CHRONICLES_DIR, '.data', `${date}.json`),
      path.join(CHRONICLES_DIR, 'notes', `${date}.md`),
    ].filter((rel) => existsSync(path.join(repoPath, rel)));

    const committed = this._commit(repoPath, relPaths, date);
    return { path: absPath, committed };
  }

  /**
   * Stage and commit the day's files. Best-effort: if git is unavailable, the
   * path is not a repo, or there is nothing to commit (identical re-run), the
   * files are still written — we just report `committed: false`.
   *
   * Scopes the commit to exactly `relPaths` via `--only`, so it never sweeps in
   * unrelated working-tree changes in the personal Chronicle repo.
   *
   * The message is a machine-authored ledger commit per ADR-0007:
   * `chronicle(daily): <date>` with `Chronicle-Window:` and `Generated-By:`
   * provenance trailers.
   */
  private _commit(repoPath: string, relPaths: string[], date: string): boolean {
    if (relPaths.length === 0) return false;
    try {
      execFileSync('git', ['-C', repoPath, 'add', ...relPaths], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      execFileSync(
        'git',
        [
          '-C',
          repoPath,
          'commit',
          '-m',
          dailyLedgerCommitSubject(date),
          '-m',
          dailyLedgerCommitTrailers(date, ENGINE_VERSION),
          '--only',
          ...relPaths,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      return true;
    } catch {
      return false;
    }
  }
}
