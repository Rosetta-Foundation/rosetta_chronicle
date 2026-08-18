import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { injectable } from 'inversify';
import { TransformationExecution } from '../types';

/**
 * Persistence adapter for an immutable transformation execution.
 *
 * Resource access only. Writes `<executionsDir>/<id>.json` — the caller
 * supplies the directory. Does not encode a personal Chronicle layout,
 * emit Activity, or touch Daily Chronicle files.
 */
export type ExecutionResolveStatus = 'ok' | 'missing' | 'invalid';

export interface ITransformationExecutionStore {
  read(
    executionsDir: string,
    id: string,
  ): Promise<TransformationExecution | null>;
  diagnose(
    executionsDir: string,
    id: string,
  ): Promise<ExecutionResolveStatus>;
  write(
    executionsDir: string,
    execution: TransformationExecution,
  ): Promise<string>;
  list(executionsDir: string): Promise<TransformationExecution[]>;
  pathFor(executionsDir: string, id: string): string;
}

const RECORD_ID = /^[a-f0-9]{64}$/;

const isExecution = (
  value: unknown,
): value is TransformationExecution => {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    Array.isArray(rec.outputRefs) &&
    Array.isArray(rec.sourceRefs) &&
    rec.producer != null &&
    typeof rec.transformationType === 'string'
  );
};

/**
 * Filesystem implementation of {@link ITransformationExecutionStore}.
 *
 * One JSON file per execution id. Files that are not executions (for
 * example a derived record written into the same directory) are
 * skipped by `list`. A malformed file reads back as null.
 */
@injectable()
export class TransformationExecutionStore
  implements ITransformationExecutionStore
{
  /** @inheritDoc */
  pathFor(executionsDir: string, id: string): string {
    return path.join(executionsDir, `${id}.json`);
  }

  /** @inheritDoc */
  async read(
    executionsDir: string,
    id: string,
  ): Promise<TransformationExecution | null> {
    if (!RECORD_ID.test(id)) return null;
    const absPath = this.pathFor(executionsDir, id);
    if (!existsSync(absPath)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(absPath, 'utf-8'));
      return isExecution(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** @inheritDoc */
  async diagnose(
    executionsDir: string,
    id: string,
  ): Promise<ExecutionResolveStatus> {
    if (!RECORD_ID.test(id)) return 'invalid';
    const absPath = this.pathFor(executionsDir, id);
    if (!existsSync(absPath)) return 'missing';
    const loaded = await this.read(executionsDir, id);
    return loaded ? 'ok' : 'invalid';
  }

  /** @inheritDoc */
  async write(
    executionsDir: string,
    execution: TransformationExecution,
  ): Promise<string> {
    if (!RECORD_ID.test(execution.id)) {
      throw new Error(`invalid execution id: ${execution.id}`);
    }
    const absPath = this.pathFor(executionsDir, execution.id);
    mkdirSync(executionsDir, { recursive: true });
    writeFileSync(absPath, JSON.stringify(execution, null, 2) + '\n');
    return absPath;
  }

  /** @inheritDoc */
  async list(executionsDir: string): Promise<TransformationExecution[]> {
    if (!existsSync(executionsDir)) return [];
    const found: TransformationExecution[] = [];
    for (const name of readdirSync(executionsDir)) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      const execution = await this.read(executionsDir, id);
      if (execution) found.push(execution);
    }
    return found;
  }
}