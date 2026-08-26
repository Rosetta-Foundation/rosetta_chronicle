import { lstatSync, readdirSync, realpathSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Files under an allowlisted file or directory. Never walks above `root`.
 * Symlinks that escape the root are skipped.
 */
export function listAllowlistedFiles(root: string): string[] {
  const rootReal = realpathSync(root);
  const rootStat = lstatSync(rootReal);
  if (rootStat.isFile()) return [rootReal];
  if (!rootStat.isDirectory()) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const child = join(dir, name);
      let st;
      try {
        st = lstatSync(child);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        let target: string;
        try {
          target = realpathSync(child);
        } catch {
          continue;
        }
        const rel = relative(rootReal, target);
        if (rel.startsWith('..') || rel.startsWith(`..${sep}`)) continue;
        try {
          if (statSync(target).isFile()) out.push(target);
        } catch {
          continue;
        }
        continue;
      }
      if (st.isDirectory()) walk(child);
      else if (st.isFile()) out.push(child);
    }
  };
  walk(rootReal);
  return out.sort();
}

export function summarizeObserveResults(
  results: { status: string; receipt?: { bytes: number } }[],
): {
  fileCount: number;
  stored: number;
  duplicate: number;
  skippedStopped: number;
  skippedForgotten: number;
  missingSource: number;
  bytesInReceipts: number;
} {
  let stored = 0;
  let duplicate = 0;
  let skippedStopped = 0;
  let skippedForgotten = 0;
  let missingSource = 0;
  let bytesInReceipts = 0;
  for (const r of results) {
    if (r.status === 'stored') stored += 1;
    else if (r.status === 'duplicate') duplicate += 1;
    else if (r.status === 'skipped-stopped') skippedStopped += 1;
    else if (r.status === 'skipped-forgotten') skippedForgotten += 1;
    else if (r.status === 'missing-source') missingSource += 1;
    bytesInReceipts += r.receipt?.bytes ?? 0;
  }
  return {
    fileCount: results.length,
    stored,
    duplicate,
    skippedStopped,
    skippedForgotten,
    missingSource,
    bytesInReceipts,
  };
}
