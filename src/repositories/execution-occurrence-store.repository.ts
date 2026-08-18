import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { injectable } from 'inversify';
import { ExecutionOccurrence } from '../types';

/**
 * Persistence adapter for one physical provider invocation.
 *
 * Resource access only. Writes `<occurrencesDir>/<id>.json`. Does not
 * encode a personal Chronicle layout or emit Activity.
 */
export interface IExecutionOccurrenceStore {
  read(
    occurrencesDir: string,
    id: string,
  ): Promise<ExecutionOccurrence | null>;
  write(
    occurrencesDir: string,
    occurrence: ExecutionOccurrence,
  ): Promise<string>;
  pathFor(occurrencesDir: string, id: string): string;
}

const RECORD_ID = /^[a-f0-9]{64}$/;

const isOccurrence = (value: unknown): value is ExecutionOccurrence => {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    typeof rec.definitionId === 'string' &&
    typeof rec.providerStatus === 'string' &&
    typeof rec.persistenceStatus === 'string' &&
    typeof rec.nonce === 'string'
  );
};

/**
 * Filesystem implementation of {@link IExecutionOccurrenceStore}.
 *
 * One JSON file per occurrence id. Append-only: callers never mutate a
 * written file.
 */
@injectable()
export class ExecutionOccurrenceStore implements IExecutionOccurrenceStore {
  /** @inheritDoc */
  pathFor(occurrencesDir: string, id: string): string {
    return path.join(occurrencesDir, `${id}.json`);
  }

  /** @inheritDoc */
  async read(
    occurrencesDir: string,
    id: string,
  ): Promise<ExecutionOccurrence | null> {
    if (!RECORD_ID.test(id)) return null;
    const absPath = this.pathFor(occurrencesDir, id);
    if (!existsSync(absPath)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(absPath, 'utf-8'));
      return isOccurrence(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** @inheritDoc */
  async write(
    occurrencesDir: string,
    occurrence: ExecutionOccurrence,
  ): Promise<string> {
    if (!RECORD_ID.test(occurrence.id)) {
      throw new Error(`invalid occurrence id: ${occurrence.id}`);
    }
    const absPath = this.pathFor(occurrencesDir, occurrence.id);
    mkdirSync(occurrencesDir, { recursive: true });
    writeFileSync(absPath, JSON.stringify(occurrence, null, 2) + '\n');
    return absPath;
  }
}
