import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { injectable } from 'inversify';
import { ObserveConfig, ObserveScope } from '../types';
import { isRecord } from '../utils/chatgpt-export.utils';

export type ObserveConfigReadResolved =
  | { ok: true; config: ObserveConfig }
  | { ok: false; reason: 'missing' | 'unreadable' | 'invalid-shape' };

/**
 * Reads and writes the V1 observe config beside the private vault.
 *
 * Resource access only. Does not decide STOP/forget policy.
 */
export interface IObserveConfigRepository {
  pathFor(dataDir: string): string;
  read(dataDir: string): Promise<ObserveConfig | null>;
  /**
   * Diagnostic read. Successful JSON parse is not enough — the
   * document must be a v1 config with shaped scopes. Legacy `read`
   * is unchanged.
   */
  readResolved(dataDir: string): Promise<ObserveConfigReadResolved>;
  write(dataDir: string, config: ObserveConfig): Promise<void>;
}

const isScope = (value: unknown): value is ObserveScope => {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    value['id'].length > 0 &&
    (value['kind'] === 'file' || value['kind'] === 'directory') &&
    typeof value['path'] === 'string' &&
    typeof value['stopped'] === 'boolean' &&
    typeof value['forgotten'] === 'boolean'
  );
};

export const isObserveConfigShape = (
  value: unknown,
): value is ObserveConfig => {
  if (!isRecord(value)) return false;
  if (value['version'] !== 1) return false;
  if (typeof value['stopped'] !== 'boolean') return false;
  if (!Array.isArray(value['scopes'])) return false;
  return value['scopes'].every(isScope);
};

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
  async readResolved(dataDir: string): Promise<ObserveConfigReadResolved> {
    const p = this.pathFor(dataDir);
    if (!existsSync(p)) return { ok: false, reason: 'missing' };
    try {
      const parsed: unknown = JSON.parse(readFileSync(p, 'utf8'));
      if (!isObserveConfigShape(parsed)) {
        return { ok: false, reason: 'invalid-shape' };
      }
      return { ok: true, config: parsed };
    } catch {
      return { ok: false, reason: 'unreadable' };
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
