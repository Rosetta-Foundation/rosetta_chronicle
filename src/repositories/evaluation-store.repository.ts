import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { injectable } from 'inversify';
import { DerivedEvaluation } from '../types';

/**
 * Persistence adapter for append-only human evaluations.
 *
 * Resource access only. Writes `<evaluationsDir>/<id>.json` — the
 * caller supplies the directory. Does not encode a personal Chronicle
 * layout, emit Activity, or mutate derived records.
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
  pathFor(evaluationsDir: string, id: string): string;
}

const RECORD_ID = /^[a-f0-9]{64}$/;

const isEvaluation = (value: unknown): value is DerivedEvaluation => {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    rec.schemaVersion === 'derived-evaluation/1' &&
    typeof rec.id === 'string' &&
    typeof rec.evaluatedRecordId === 'string' &&
    typeof rec.evaluatedAt === 'string' &&
    typeof rec.recordedAt === 'string' &&
    rec.evaluator != null &&
    typeof rec.evaluator === 'object'
  );
};

/**
 * Filesystem implementation of {@link IEvaluationStore}.
 *
 * One JSON file per evaluation id. A malformed file reads back as null
 * so a re-record can rewrite it.
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
      return isEvaluation(parsed) ? parsed : null;
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
  async write(
    evaluationsDir: string,
    evaluation: DerivedEvaluation,
  ): Promise<string> {
    if (!RECORD_ID.test(evaluation.id)) {
      throw new Error(`invalid evaluation id: ${evaluation.id}`);
    }
    const absPath = this.pathFor(evaluationsDir, evaluation.id);
    mkdirSync(evaluationsDir, { recursive: true });
    writeFileSync(absPath, JSON.stringify(evaluation, null, 2) + '\n');
    return absPath;
  }
}
