import { homedir } from 'os';
import { join } from 'path';

/**
 * Product default for observe vault + receipts.
 *
 * Operator-chosen `--data-dir` and `$CHRONICLE_DATA_DIR` win.
 * Existing pilot directories are not migrated.
 */
export const defaultChronicleDataDir = (home = homedir()): string =>
  join(home, '.local', 'share', 'rosetta', 'chronicle', 'default');

/**
 * Resolve the observe data-dir: explicit flag, then env, then the
 * product default under the home directory.
 */
export const resolveChronicleDataDir = (
  explicit?: string,
  env: NodeJS.Dict<string | undefined> = process.env,
  home = homedir(),
): string => explicit ?? env['CHRONICLE_DATA_DIR'] ?? defaultChronicleDataDir(home);
