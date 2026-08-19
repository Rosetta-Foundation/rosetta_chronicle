import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { injectable } from 'inversify';
import { DerivedEvaluation, StoreInventory } from '../types';
import { asDerivedEvaluation } from '../utils/evaluation.utils';

/**
 * Persistence adapter for append-only human evaluations.
 *
 * Resource access only. Writes `<evaluationsDir>/<id>.json`. Does not
 * encode a personal Chronicle layout, emit Activity, or mutate derived
 * records. `write` is append-only: a present file is never rewritten.
 * Identical content is already-present; different content is an
 * integrity error. A malformed file is corruption, not a rewrite permit.
 */
export type EvaluationResolveStatus = 'ok' | 'missing' | 'invalid';

export interface IEvaluationStore {
  read(evaluationsDir: string, id: string): Promise<DerivedEvaluation | null>;
  diagnose(
    evaluationsDir: string,
    id: string,
  ): Promise<EvaluationResolveStatus>;
  write(evaluationsDir: string, evaluation: DerivedEvaluation): Promise<string>;
  list(evaluationsDir: string): Promise<DerivedEvaluation[]>;
  /**
   * Enumerate valid evaluations and structurally invalid siblings.
   * `list` remains the valid-only helper. Current-understanding must
   * use this so `ok` is not claimed over silent corruption.
   */
  listResolved(
    evaluationsDir: string,
  ): Promise<StoreInventory<DerivedEvaluation>>;
  pathFor(evaluationsDir: string, id: string): string;
}

const RECORD_ID = /^[a-f0-9]{64}$/;

/**
 * Stable JSON for integrity compare. `recordedAt` is not in the id but
 * still must not be rewritten once the artifact exists.
 */
const canonicalize = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(item as object).sort()) {
        sorted[key] = (item as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return item;
  });

/**
 * Filesystem implementation of {@link IEvaluationStore}.
 *
 * One JSON file per evaluation id. Content-addressed: read/diagnose
 * recompute identity from stored fields. Append-only at this boundary.
 */
@injectable()
export class EvaluationStore implements IEvaluationStore {
  /** @inheritDoc */
  pathFor(evaluationsDir: string, id: string): string {
    return path.join(evaluationsDir, `${id}.json`);
  }

  /** @inheritDoc */
  async read(
    evaluationsDir: string,
    id: string,
  ): Promise<DerivedEvaluation | null> {
    if (!RECORD_ID.test(id)) return null;
    const absPath = this.pathFor(evaluationsDir, id);
    if (!existsSync(absPath)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(absPath, 'utf-8'));
      const evaluation = asDerivedEvaluation(parsed);
      if (!evaluation || evaluation.id !== id) return null;
      return evaluation;
    } catch {
      return null;
    }
  }

  /** @inheritDoc */
  async diagnose(
    evaluationsDir: string,
    id: string,
  ): Promise<EvaluationResolveStatus> {
    if (!RECORD_ID.test(id)) return 'invalid';
    const absPath = this.pathFor(evaluationsDir, id);
    if (!existsSync(absPath)) return 'missing';
    const loaded = await this.read(evaluationsDir, id);
    return loaded ? 'ok' : 'invalid';
  }

  /** @inheritDoc */
  async list(evaluationsDir: string): Promise<DerivedEvaluation[]> {
    if (!existsSync(evaluationsDir)) return [];
    const found: DerivedEvaluation[] = [];
    for (const name of readdirSync(evaluationsDir)) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      const evaluation = await this.read(evaluationsDir, id);
      if (evaluation) found.push(evaluation);
    }
    return found;
  }

  /** @inheritDoc */
  async listResolved(
    evaluationsDir: string,
  ): Promise<StoreInventory<DerivedEvaluation>> {
    if (!existsSync(evaluationsDir)) {
      return { present: false, records: [], failures: [] };
    }
    const records: DerivedEvaluation[] = [];
    const failures: StoreInventory<DerivedEvaluation>['failures'] = [];
    for (const name of readdirSync(evaluationsDir).sort()) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      const evaluation = RECORD_ID.test(id)
        ? await this.read(evaluationsDir, id)
        : null;
      if (evaluation) {
        records.push(evaluation);
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
  async write(
    evaluationsDir: string,
    evaluation: DerivedEvaluation,
  ): Promise<string> {
    if (!RECORD_ID.test(evaluation.id)) {
      throw new Error(`invalid evaluation id: ${evaluation.id}`);
    }
    if (!asDerivedEvaluation(evaluation)) {
      throw new Error(`evaluation-conflict:identity:${evaluation.id}`);
    }
    const absPath = this.pathFor(evaluationsDir, evaluation.id);
    if (existsSync(absPath)) {
      let existing: unknown;
      try {
        existing = JSON.parse(readFileSync(absPath, 'utf-8'));
      } catch {
        throw new Error(`evaluation-conflict:unreadable:${evaluation.id}`);
      }
      const parsed = asDerivedEvaluation(existing);
      if (!parsed || parsed.id !== evaluation.id) {
        throw new Error(`evaluation-conflict:invalid:${evaluation.id}`);
      }
      if (canonicalize(parsed) !== canonicalize(evaluation)) {
        throw new Error(`evaluation-conflict:immutable:${evaluation.id}`);
      }
      return absPath;
    }
    mkdirSync(evaluationsDir, { recursive: true });
    writeFileSync(absPath, JSON.stringify(evaluation, null, 2) + '\n');
    return absPath;
  }
}
