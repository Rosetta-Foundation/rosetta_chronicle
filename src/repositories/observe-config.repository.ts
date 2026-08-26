import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { injectable } from 'inversify';
import { ObserveConfig } from '../types';

/**
 * Reads and writes the V1 observe config beside the private vault.
 *
 * Resource access only. Does not decide STOP/forget policy.
 */
export interface IObserveConfigRepository {
  pathFor(dataDir: string): string;
  read(dataDir: string): Promise<ObserveConfig | null>;
  write(dataDir: string, config: ObserveConfig): Promise<void>;
}

/**
 * `config.json` in the operator-chosen data directory.
 */
@injectable()
export class ObserveConfigRepository implements IObserveConfigRepository {
  /** @inheritDoc */
  pathFor(dataDir: string): string {
    return join(dataDir, 'config.json');
  }

  /** @inheritDoc */
  async read(dataDir: string): Promise<ObserveConfig | null> {
    const p = this.pathFor(dataDir);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as ObserveConfig;
    } catch {
      return null;
    }
  }

  /** @inheritDoc */
  async write(dataDir: string, config: ObserveConfig): Promise<void> {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      this.pathFor(dataDir),
      JSON.stringify(config, null, 2) + '\n',
      { mode: 0o600 },
    );
  }
}
