import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { injectable } from 'inversify';
import { ObservationReceipt } from '../types';
import { isRecord } from '../utils/chatgpt-export.utils';

const HASH = /^[a-f0-9]{64}$/;

export interface ReceiptInventory {
  receipts: ObservationReceipt[];
  discovered: number;
  invalid: number;
  truncated: boolean;
}

/**
 * Append-only observation receipts in the private data directory.
 *
 * Receipts are provenance, not source bodies. Forget-scope deletes the
 * receipts Chronicle wrote for that scope.
 */
export interface IObservationReceiptRepository {
  append(dataDir: string, receipt: ObservationReceipt): Promise<void>;
  list(dataDir: string): Promise<ObservationReceipt[]>;
  /**
   * Diagnostic inventory. Malformed or unshaped JSON is counted, not
   * silently dropped. Caps enumeration so a huge receipts dir cannot
   * unbounded-scan. Legacy `list` is unchanged.
   */
  listResolved(dataDir: string, maxReceipts: number): Promise<ReceiptInventory>;
  deleteByScope(dataDir: string, scopeId: string): Promise<number>;
}

export const isObservationReceiptShape = (
  value: unknown,
): value is ObservationReceipt => {
  if (!isRecord(value)) return false;
  return (
    typeof value['observationId'] === 'string' &&
    value['observationId'].length > 0 &&
    typeof value['scopeId'] === 'string' &&
    value['scopeId'].length > 0 &&
    value['sourceKind'] === 'file' &&
    typeof value['sourcePath'] === 'string' &&
    typeof value['capturedAt'] === 'string' &&
    typeof value['contentHash'] === 'string' &&
    HASH.test(value['contentHash']) &&
    typeof value['bytes'] === 'number' &&
    Number.isFinite(value['bytes']) &&
    value['bytes'] >= 0 &&
    value['clockClass'] === 'meta' &&
    typeof value['duplicate'] === 'boolean'
  );
};

/**
 * One JSON file per observation under `receipts/`.
 */
@injectable()
export class ObservationReceiptRepository implements IObservationReceiptRepository {
  private dir(dataDir: string): string {
    return join(dataDir, 'receipts');
  }

  /** @inheritDoc */
  async append(dataDir: string, receipt: ObservationReceipt): Promise<void> {
    const dir = this.dir(dataDir);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `${receipt.observationId}.json`);
    writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n', {
      mode: 0o600,
    });
  }

  /** @inheritDoc */
  async list(dataDir: string): Promise<ObservationReceipt[]> {
    const dir = this.dir(dataDir);
    if (!existsSync(dir)) return [];
    const out: ObservationReceipt[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        out.push(
          JSON.parse(
            readFileSync(join(dir, name), 'utf8'),
          ) as ObservationReceipt,
        );
      } catch {
        continue;
      }
    }
    return out;
  }

  /** @inheritDoc */
  async listResolved(
    dataDir: string,
    maxReceipts: number,
  ): Promise<ReceiptInventory> {
    const dir = this.dir(dataDir);
    if (!existsSync(dir)) {
      return {
        receipts: [],
        discovered: 0,
        invalid: 0,
        truncated: false,
      };
    }
    const names = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
    const receipts: ObservationReceipt[] = [];
    let discovered = 0;
    let invalid = 0;
    let truncated = false;
    for (const name of names) {
      discovered += 1;
      if (receipts.length >= maxReceipts) {
        truncated = true;
        break;
      }
      try {
        const parsed: unknown = JSON.parse(
          readFileSync(join(dir, name), 'utf8'),
        );
        if (!isObservationReceiptShape(parsed)) {
          invalid += 1;
          continue;
        }
        receipts.push(parsed);
      } catch {
        invalid += 1;
      }
    }
    return { receipts, discovered, invalid, truncated };
  }

  /** @inheritDoc */
  async deleteByScope(dataDir: string, scopeId: string): Promise<number> {
    const dir = this.dir(dataDir);
    if (!existsSync(dir)) return 0;
    let n = 0;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const p = join(dir, name);
      try {
        const rec = JSON.parse(readFileSync(p, 'utf8')) as ObservationReceipt;
        if (rec.scopeId === scopeId) {
          unlinkSync(p);
          n += 1;
        }
      } catch {
        continue;
      }
    }
    return n;
  }
}
