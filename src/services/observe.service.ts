import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join } from 'path';
import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import {
  ObserveCommand,
  ObserveConfig,
  ObserveFileResult,
  ObservationReceipt,
  ObserveVaultStatus,
} from '../types';
import type { ISourceVaultRepository } from '../repositories/source-vault.repository';
import { sha256Bytes } from '../repositories/source-vault.repository';
import type { IObserveConfigRepository } from '../repositories/observe-config.repository';
import type { IObservationReceiptRepository } from '../repositories/observation-receipt.repository';

/**
 * V1 raw observe: allowlisted file → hash → copy-if-new → receipt.
 *
 * No interpretation, no Activity. STOP and forget-scope are operator
 * controls over Chronicle-owned copies only.
 */
export interface IObserveService {
  handle(command: ObserveCommand): Promise<unknown>;
}

function vaultRootOf(dataDir: string): string {
  return join(dataDir, 'vault');
}

/**
 * Observe orchestration. Repositories own bytes and JSON; this service
 * owns skip/forget/dedup rules.
 */
@injectable()
export class ObserveService implements IObserveService {
  constructor(
    @inject(CHRONICLE_TOKENS.SourceVaultRepository)
    private readonly _vault: ISourceVaultRepository,
    @inject(CHRONICLE_TOKENS.ObserveConfigRepository)
    private readonly _config: IObserveConfigRepository,
    @inject(CHRONICLE_TOKENS.ObservationReceiptRepository)
    private readonly _receipts: IObservationReceiptRepository,
  ) {}

  /** @inheritDoc */
  async handle(command: ObserveCommand): Promise<unknown> {
    switch (command.op) {
      case 'init':
        return this.init(command);
      case 'observe':
        return this.observeScope(
          command.dataDir,
          command.scopeId,
          command.capturedAt,
        );
      case 'watch-once':
        return this.watchOnce(command.dataDir, command.capturedAt);
      case 'stop':
        return this.setStopped(command.dataDir, command.scopeId, true);
      case 'resume':
        return this.setStopped(command.dataDir, command.scopeId, false);
      case 'forget-scope':
        return this.forgetScope(command.dataDir, command.scopeId);
      case 'status':
        return this.status(command.dataDir);
      case 'resolve':
        return this.resolve(
          command.dataDir,
          command.contentHash,
          command.outputPath,
        );
    }
  }

  private async init(command: {
    dataDir: string;
    scopeId: string;
    filePath: string;
  }): Promise<ObserveConfig> {
    const existing = await this._config.read(command.dataDir);
    const path = isAbsolute(command.filePath)
      ? command.filePath
      : join(process.cwd(), command.filePath);
    const scope = {
      id: command.scopeId,
      kind: 'file' as const,
      path,
      stopped: false,
      forgotten: false,
    };
    const config: ObserveConfig = existing ?? {
      version: 1,
      stopped: false,
      scopes: [],
    };
    const idx = config.scopes.findIndex((s) => s.id === command.scopeId);
    if (idx >= 0) config.scopes[idx] = scope;
    else config.scopes.push(scope);
    await this._config.write(command.dataDir, config);
    return config;
  }

  private async requireConfig(dataDir: string): Promise<ObserveConfig> {
    const config = await this._config.read(dataDir);
    if (!config) throw new Error(`observe config missing: ${dataDir}`);
    return config;
  }

  private async observeScope(
    dataDir: string,
    scopeId: string,
    capturedAt?: string,
  ): Promise<ObserveFileResult> {
    const config = await this.requireConfig(dataDir);
    const scope = config.scopes.find((s) => s.id === scopeId);
    if (!scope) throw new Error(`unknown scope: ${scopeId}`);
    if (scope.forgotten) {
      return { status: 'skipped-forgotten' };
    }
    if (config.stopped || scope.stopped) {
      return { status: 'skipped-stopped' };
    }
    if (!existsSync(scope.path)) {
      return { status: 'missing-source' };
    }
    const bytes = readFileSync(scope.path);
    const contentHash = sha256Bytes(bytes);
    const at = capturedAt ?? new Date().toISOString();
    const put = await this._vault.putIfNew(
      vaultRootOf(dataDir),
      contentHash,
      bytes,
    );
    const receipt: ObservationReceipt = {
      observationId: `obs-${contentHash.slice(0, 12)}-${Date.now()}`,
      scopeId,
      sourceKind: 'file',
      sourcePath: scope.path,
      capturedAt: at,
      contentHash,
      bytes: bytes.length,
      clockClass: 'meta',
      duplicate: put.existed,
    };
    await this._receipts.append(dataDir, receipt);
    return {
      status: put.existed ? 'duplicate' : 'stored',
      receipt,
    };
  }

  private async watchOnce(
    dataDir: string,
    capturedAt?: string,
  ): Promise<ObserveFileResult[]> {
    const config = await this.requireConfig(dataDir);
    const results: ObserveFileResult[] = [];
    for (const scope of config.scopes) {
      results.push(await this.observeScope(dataDir, scope.id, capturedAt));
    }
    return results;
  }

  private async setStopped(
    dataDir: string,
    scopeId: string | undefined,
    stopped: boolean,
  ): Promise<ObserveConfig> {
    const config = await this.requireConfig(dataDir);
    if (!scopeId) {
      config.stopped = stopped;
    } else {
      const scope = config.scopes.find((s) => s.id === scopeId);
      if (!scope) throw new Error(`unknown scope: ${scopeId}`);
      if (scope.forgotten && !stopped) {
        throw new Error('cannot resume a forgotten scope');
      }
      scope.stopped = stopped;
    }
    await this._config.write(dataDir, config);
    return config;
  }

  private async forgetScope(
    dataDir: string,
    scopeId: string,
  ): Promise<{ deletedReceipts: number; deletedObjects: number }> {
    const config = await this.requireConfig(dataDir);
    const scope = config.scopes.find((s) => s.id === scopeId);
    if (!scope) throw new Error(`unknown scope: ${scopeId}`);
    const receipts = await this._receipts.list(dataDir);
    const hashes = new Set(
      receipts.filter((r) => r.scopeId === scopeId).map((r) => r.contentHash),
    );
    const deletedReceipts = await this._receipts.deleteByScope(
      dataDir,
      scopeId,
    );
    const remaining = await this._receipts.list(dataDir);
    const stillCited = new Set(remaining.map((r) => r.contentHash));
    let deletedObjects = 0;
    for (const hash of hashes) {
      if (!stillCited.has(hash)) {
        await this._vault.unlink(vaultRootOf(dataDir), hash);
        deletedObjects += 1;
      }
    }
    scope.forgotten = true;
    scope.stopped = true;
    await this._config.write(dataDir, config);
    return { deletedReceipts, deletedObjects };
  }

  private async status(dataDir: string): Promise<ObserveVaultStatus> {
    const config = await this.requireConfig(dataDir);
    const receipts = await this._receipts.list(dataDir);
    return {
      stopped: config.stopped,
      scopeCount: config.scopes.length,
      objectCount: await this._vault.objectCount(vaultRootOf(dataDir)),
      receiptCount: receipts.length,
      scopes: config.scopes,
    };
  }

  private async resolve(
    dataDir: string,
    contentHash: string,
    outputPath: string,
  ): Promise<{ ok: boolean }> {
    const bytes = await this._vault.get(vaultRootOf(dataDir), contentHash);
    if (!bytes) return { ok: false };
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, bytes);
    return { ok: true };
  }
}
