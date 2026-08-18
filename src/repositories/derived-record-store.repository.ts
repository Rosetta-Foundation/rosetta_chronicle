import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { injectable } from 'inversify';
import { DerivedRecord } from '../types';

/**
 * Persistence adapter for a provenance-preserving derived record.
 *
 * Resource access only. Writes `<outputDir>/<id>.json` — the caller
 * supplies the directory. Does not encode a personal Chronicle layout,
 * emit Activity, or touch Daily Chronicle files.
 */
export interface IDerivedRecordStore {
  read(outputDir: string, id: string): Promise<DerivedRecord | null>;
  write(outputDir: string, record: DerivedRecord): Promise<string>;
  pathFor(outputDir: string, id: string): string;
}

const RECORD_ID = /^[a-f0-9]{64}$/;

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
      return JSON.parse(readFileSync(absPath, 'utf-8')) as DerivedRecord;
    } catch {
      return null;
    }
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
