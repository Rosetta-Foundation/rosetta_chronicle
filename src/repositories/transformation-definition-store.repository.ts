import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { injectable } from 'inversify';
import { TransformationDefinition } from '../types';
import { validateTransformationDefinition } from '../utils/transformation.utils';

/**
 * Persistence adapter for an immutable transformation definition.
 *
 * Resource access only. Writes `<definitionsDir>/<id>.json` — the
 * caller supplies the directory. Does not encode a personal Chronicle
 * layout, emit Activity, or touch Daily Chronicle files.
 */
export type DefinitionResolveStatus = 'ok' | 'missing' | 'invalid';

export interface ITransformationDefinitionStore {
  read(
    definitionsDir: string,
    id: string,
  ): Promise<TransformationDefinition | null>;
  /**
   * Why `read` would fail. Distinguishes a missing file from a
   * present-but-unreadable artifact (malformed or hash-invalid).
   */
  diagnose(
    definitionsDir: string,
    id: string,
  ): Promise<DefinitionResolveStatus>;
  write(
    definitionsDir: string,
    definition: TransformationDefinition,
  ): Promise<string>;
  list(definitionsDir: string): Promise<TransformationDefinition[]>;
  pathFor(definitionsDir: string, id: string): string;
}

const RECORD_ID = /^[a-f0-9]{64}$/;

const isDefinition = (
  value: unknown,
): value is TransformationDefinition => {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    typeof rec.type === 'string' &&
    typeof rec.version === 'string' &&
    typeof rec.description === 'string' &&
    typeof rec.contentHash === 'string' &&
    Array.isArray(rec.allowedProducerTypes)
  );
};

/**
 * Filesystem implementation of {@link ITransformationDefinitionStore}.
 *
 * One JSON file per definition id. A malformed or hash-mismatched file
 * reads back as null. Write rejects invalid artifacts so a bad recipe
 * never becomes durable.
 */
@injectable()
export class TransformationDefinitionStore
  implements ITransformationDefinitionStore
{
  /** @inheritDoc */
  pathFor(definitionsDir: string, id: string): string {
    return path.join(definitionsDir, `${id}.json`);
  }

  /** @inheritDoc */
  async read(
    definitionsDir: string,
    id: string,
  ): Promise<TransformationDefinition | null> {
    if (!RECORD_ID.test(id)) return null;
    const absPath = this.pathFor(definitionsDir, id);
    if (!existsSync(absPath)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(absPath, 'utf-8'));
      if (!isDefinition(parsed)) return null;
      if (validateTransformationDefinition(parsed).length > 0) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /** @inheritDoc */
  async diagnose(
    definitionsDir: string,
    id: string,
  ): Promise<DefinitionResolveStatus> {
    if (!RECORD_ID.test(id)) return 'invalid';
    const absPath = this.pathFor(definitionsDir, id);
    if (!existsSync(absPath)) return 'missing';
    const loaded = await this.read(definitionsDir, id);
    return loaded ? 'ok' : 'invalid';
  }

  /** @inheritDoc */
  async write(
    definitionsDir: string,
    definition: TransformationDefinition,
  ): Promise<string> {
    const errors = validateTransformationDefinition(definition);
    if (errors.length > 0) {
      throw new Error(`invalid transformation definition: ${errors.join(', ')}`);
    }
    const absPath = this.pathFor(definitionsDir, definition.id);
    mkdirSync(definitionsDir, { recursive: true });
    writeFileSync(absPath, JSON.stringify(definition, null, 2) + '\n');
    return absPath;
  }

  /** @inheritDoc */
  async list(
    definitionsDir: string,
  ): Promise<TransformationDefinition[]> {
    if (!existsSync(definitionsDir)) return [];
    const found: TransformationDefinition[] = [];
    for (const name of readdirSync(definitionsDir)) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      const definition = await this.read(definitionsDir, id);
      if (definition) found.push(definition);
    }
    return found;
  }
}
