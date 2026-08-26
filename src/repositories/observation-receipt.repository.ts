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

/**
 * Append-only observation receipts in the private data directory.
 *
 * Receipts are provenance, not source bodies. Forget-scope deletes the
 * receipts Chronicle wrote for that scope.
 */
export interface IObservationReceiptRepository {
  append(dataDir: string, receipt: ObservationReceipt): Promise<void>;
  list(dataDir: string): Promise<ObservationReceipt[]>;
  deleteByScope(dataDir: string, scopeId: string): Promise<number>;
}

/**
 * One JSON file per observation under `receipts/`.
 */
@injectable()
export class ObservationReceiptRepository
  implements IObservationReceiptRepository
{
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
  async deleteByScope(dataDir: string, scopeId: string): Promise<number> {
    const dir = this.dir(dataDir);
    if (!existsSync(dir)) return 0;
    let n = 0;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const p = join(dir, name);
      try {
        const rec = JSON.parse(
          readFileSync(p, 'utf8'),
        ) as ObservationReceipt;
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
