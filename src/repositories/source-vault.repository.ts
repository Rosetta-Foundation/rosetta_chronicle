import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import { injectable } from 'inversify';

/**
 * Content-addressed store for observed source bytes.
 *
 * Objects are canonical evidence. Identity is SHA-256 of exact bytes.
 * Copy-if-new; never interprets content. Not a Git repository.
 */
export interface ISourceVaultRepository {
  objectPath(vaultRoot: string, contentHash: string): string;
  putIfNew(
    vaultRoot: string,
    contentHash: string,
    bytes: Buffer,
  ): Promise<{ existed: boolean }>;
  get(vaultRoot: string, contentHash: string): Promise<Buffer | null>;
  unlink(vaultRoot: string, contentHash: string): Promise<void>;
  objectCount(vaultRoot: string): Promise<number>;
}

const HASH = /^[a-f0-9]{64}$/;

/**
 * Filesystem vault: `objects/sha256/<aa>/<hash>`.
 *
 * Restricts directory mode to 0o700 when creating. Does not encrypt;
 * V1 encryption is the host OS disk.
 */
@injectable()
export class SourceVaultRepository implements ISourceVaultRepository {
  /** @inheritDoc */
  objectPath(vaultRoot: string, contentHash: string): string {
    return join(
      vaultRoot,
      'objects',
      'sha256',
      contentHash.slice(0, 2),
      contentHash,
    );
  }

  /** @inheritDoc */
  async putIfNew(
    vaultRoot: string,
    contentHash: string,
    bytes: Buffer,
  ): Promise<{ existed: boolean }> {
    if (!HASH.test(contentHash)) {
      throw new Error('invalid content hash');
    }
    const dest = this.objectPath(vaultRoot, contentHash);
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    if (existsSync(dest)) return { existed: true };
    writeFileSync(dest, bytes, { mode: 0o600 });
    return { existed: false };
  }

  /** @inheritDoc */
  async get(vaultRoot: string, contentHash: string): Promise<Buffer | null> {
    if (!HASH.test(contentHash)) return null;
    const dest = this.objectPath(vaultRoot, contentHash);
    if (!existsSync(dest)) return null;
    return readFileSync(dest);
  }

  /** @inheritDoc */
  async unlink(vaultRoot: string, contentHash: string): Promise<void> {
    const dest = this.objectPath(vaultRoot, contentHash);
    if (existsSync(dest)) unlinkSync(dest);
  }

  /** @inheritDoc */
  async objectCount(vaultRoot: string): Promise<number> {
    const root = join(vaultRoot, 'objects', 'sha256');
    if (!existsSync(root)) return 0;
    return readdirSync(root, { recursive: true })
      .map((n) => String(n).split('/').pop() ?? '')
      .filter((n) => HASH.test(n)).length;
  }
}

export function sha256Bytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
