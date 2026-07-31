import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { injectable } from 'inversify';
import { DailyChronicleData } from '../types';

/**
 * Persistence adapter for the durable structured Chronicle sidecar. Resource
 * access only — no business logic.
 *
 * Stores the day's structured activity + tags as JSON under
 * `<repoPath>/chronicles/.data/<date>.json`, alongside the rendered Markdown.
 * This JSON — not the Markdown — is the source of truth a regeneration reads
 * back (PRD-0002 Phase 2), so tags and activity are never recovered by
 * re-parsing rendered output.
 */
export interface IChronicleStore {
  /** Persist the structured data for a day (overwrites; regenerable). */
  writeDaily(repoPath: string, data: DailyChronicleData): Promise<void>;
  /** Read the structured data for `date` (YYYY-MM-DD), or null if absent. */
  readDaily(repoPath: string, date: string): Promise<DailyChronicleData | null>;
}

const DATA_DIR = path.join('chronicles', '.data');

/**
 * Filesystem implementation of {@link IChronicleStore}.
 *
 * One JSON file per day. The sidecar is a cache of regenerable data (unlike the
 * authoritative notes file), so writes overwrite freely; a malformed or
 * unreadable file reads back as null rather than throwing, so a corrupt sidecar
 * degrades to "regenerate from source" instead of failing the Chronicle.
 */
@injectable()
export class ChronicleStore implements IChronicleStore {
  /** @inheritDoc */
  async writeDaily(repoPath: string, data: DailyChronicleData): Promise<void> {
    const absDir = path.join(repoPath, DATA_DIR);
    const absPath = path.join(absDir, `${data.window.start}.json`);
    mkdirSync(absDir, { recursive: true });
    writeFileSync(absPath, JSON.stringify(data, null, 2) + '\n');
  }

  /** @inheritDoc */
  async readDaily(
    repoPath: string,
    date: string,
  ): Promise<DailyChronicleData | null> {
    const absPath = path.join(repoPath, DATA_DIR, `${date}.json`);
    if (!existsSync(absPath)) return null;
    try {
      return JSON.parse(readFileSync(absPath, 'utf-8')) as DailyChronicleData;
    } catch {
      // Corrupt/partial sidecar — treat as absent so we regenerate from source.
      return null;
    }
  }
}
