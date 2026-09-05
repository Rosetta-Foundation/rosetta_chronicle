import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Package version printed by `chronicle version` / `--version` as a
 * command. Not the transform-record `--version <n>` recipe flag.
 */
export const readCliVersion = (packageRoot: string): string => {
  const raw = readFileSync(join(packageRoot, 'package.json'), 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as { version?: unknown }).version !== 'string'
  ) {
    throw new Error('package.json is missing a version string');
  }
  return (parsed as { version: string }).version;
};

/** Repo root when this file is compiled to `dist/utils`. */
export const packageRootFromDist = (dirname = __dirname): string =>
  join(dirname, '..', '..');
