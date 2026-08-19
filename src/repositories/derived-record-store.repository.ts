import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { injectable } from 'inversify';
import { DerivedRecord, StoreInventory } from '../types';

/**
 * Persistence adapter for a provenance-preserving derived record.
 *
 * Resource access only. Writes `<outputDir>/<id>.json` — the caller
 * supplies the directory. Does not encode a personal Chronicle layout,
 * emit Activity, or touch Daily Chronicle files.
 */
export type DerivedResolveStatus = 'ok' | 'missing' | 'invalid';

export interface IDerivedRecordStore {
  read(outputDir: string, id: string): Promise<DerivedRecord | null>;
  diagnose(outputDir: string, id: string): Promise<DerivedResolveStatus>;
  write(outputDir: string, record: DerivedRecord): Promise<string>;
  list(outputDir: string): Promise<DerivedRecord[]>;
  /**
   * Enumerate valid derived records and structurally invalid siblings.
   * `list` remains the valid-only helper. Current-understanding must
   * use this so `ok` is not claimed over silent corruption.
   */
  listResolved(outputDir: string): Promise<StoreInventory<DerivedRecord>>;
  pathFor(outputDir: string, id: string): string;
}

const RECORD_ID = /^[a-f0-9]{64}$/;

const isDerived = (value: unknown): value is DerivedRecord => {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    Array.isArray(rec.sourceRefs) &&
    typeof rec.contentRef === 'string' &&
    typeof rec.reviewState === 'string'
  );
};

/**
 * Filesystem implementation of {@link IDerivedRecordStore}.
 *
 * One JSON file per derived-record id. A malformed file reads back as
 * null so a re-record can rewrite it.
 */
@injectable()
export class DerivedRecordStore implements IDerivedRecordStore {
  /** @inheritDoc */
  pathFor(outputDir: string, id: string): string {
    return path.join(outputDir, `${id}.json`);
  }

  /** @inheritDoc */
  async read(
    outputDir: string,
    id: string,
  ): Promise<DerivedRecord | null> {
    if (!RECORD_ID.test(id)) return null;
    const absPath = this.pathFor(outputDir, id);
    if (!existsSync(absPath)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(absPath, 'utf-8'));
      return isDerived(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** @inheritDoc */
  async diagnose(
    outputDir: string,
    id: string,
  ): Promise<DerivedResolveStatus> {
    if (!RECORD_ID.test(id)) return 'invalid';
    const absPath = this.pathFor(outputDir, id);
    if (!existsSync(absPath)) return 'missing';
    const loaded = await this.read(outputDir, id);
    return loaded ? 'ok' : 'invalid';
  }

  /** @inheritDoc */
  async list(outputDir: string): Promise<DerivedRecord[]> {
    if (!existsSync(outputDir)) return [];
    const found: DerivedRecord[] = [];
    for (const name of readdirSync(outputDir)) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      const record = await this.read(outputDir, id);
      if (record) found.push(record);
    }
    return found;
  }

  /** @inheritDoc */
  async listResolved(
    outputDir: string,
  ): Promise<StoreInventory<DerivedRecord>> {
    if (!existsSync(outputDir)) {
      return { present: false, records: [], failures: [] };
    }
    const records: DerivedRecord[] = [];
    const failures: StoreInventory<DerivedRecord>['failures'] = [];
    for (const name of readdirSync(outputDir).sort()) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      const record = RECORD_ID.test(id)
        ? await this.read(outputDir, id)
        : null;
      if (record) {
        records.push(record);
        continue;
      }
      failures.push({
        filename: name,
        ...(RECORD_ID.test(id) ? { id } : {}),
        status: 'invalid',
      });
    }
    return { present: true, records, failures };
  }

  /** @inheritDoc */
  async write(outputDir: string, record: DerivedRecord): Promise<string> {
    if (!RECORD_ID.test(record.id)) {
      throw new Error(`invalid derived record id: ${record.id}`);
    }
    const absPath = this.pathFor(outputDir, record.id);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(absPath, JSON.stringify(record, null, 2) + '\n');
    return absPath;
  }
}
