import { join } from 'path';
import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import {
  CONTEXT_PACKET_SCHEMA_VERSION,
  ContextPacket,
  ContextPacketCoverage,
  ContextPacketEvidenceItem,
  ContextPacketFailure,
  ContextPacketInput,
  ContextPacketLimitation,
  ContextPacketUnresolved,
} from '../types';
import type { IObserveConfigRepository } from '../repositories/observe-config.repository';
import type { IObservationReceiptRepository } from '../repositories/observation-receipt.repository';
import type { ISourceVaultRepository } from '../repositories/source-vault.repository';
import { isConversationShardPath } from '../utils/lexical-search.utils';
import { normalizeLexicalText } from '../utils/lexical-search.utils';
import {
  MANDATORY_LIMITATIONS,
  packetPolicy,
  validateContextPacketRequest,
} from '../utils/context-packet-request.utils';
import {
  ConversationTopology,
  DiagnosticNode,
  parseShardDiagnostics,
} from '../utils/context-packet-extract.utils';
import {
  EligibleOccurrence,
  enforcePacketByteBudget,
  matchNodeSelectors,
  neighborNodes,
  occurrenceKey,
  PacketCandidate,
  selectPacketEvidence,
  toEvidenceItem,
} from '../utils/context-packet-select.utils';
import { validateContextPacket } from '../utils/context-packet-validate.utils';

export interface IContextPacketService {
  assemble(input: ContextPacketInput): Promise<ContextPacket>;
}

const vaultRootOf = (dataDir: string): string => join(dataDir, 'vault');

const emptyCoverage = (): ContextPacketCoverage => ({
  discoveredReceipts: 0,
  invalidReceipts: 0,
  receiptEnumerationComplete: true,
  eligibleOccurrences: 0,
  discoveredShards: 0,
  verifiedShards: 0,
  scannedShards: 0,
  failedShards: 0,
  scannedBytes: 0,
  scannedNodes: 0,
  candidateCount: 0,
  selectedCount: 0,
  omittedCount: 0,
  unsupportedContentCount: 0,
  undatedCount: 0,
  scanComplete: true,
  selectionComplete: true,
  earlyExitReasons: [],
});

const basePacket = (
  input: ContextPacketInput,
  generatedAt: string,
  extras: Partial<ContextPacket> & Pick<ContextPacket, 'status'>,
): ContextPacket => ({
  schemaVersion: CONTEXT_PACKET_SCHEMA_VERSION,
  policy: packetPolicy(),
  generatedAt,
  sourceTimeSemantics: 'vendor-create-time',
  identityResolution: 'not-performed',
  conceptOrigin: 'not-established',
  scopes: input.scopes,
  matchMode: input.matchMode ?? 'raw',
  selectors: input.selectors,
  evidence: [],
  coverage: emptyCoverage(),
  limitations: [...MANDATORY_LIMITATIONS],
  unresolved: [
    {
      code: 'source-graph-unresolved',
      message: 'Vault-node refs only. No verified export-membership bridge.',
    },
  ],
  failures: [],
  audit: {
    complete: false,
    policyId: packetPolicy().id,
    policyVersion: packetPolicy().version,
    selectorCount: input.selectors.length,
    matchMode: input.matchMode ?? 'raw',
    scopeCount: input.scopes.length,
    stageCounts: {},
    omissionCounts: {},
    selectedReasons: {},
  },
  ...extras,
});

/**
 * Assembles one bounded lexical evidence packet. Read-only. Does not
 * call SearchService, a model, or persist the packet. Forgotten and
 * unrequested scopes do not appear in output.
 */
@injectable()
export class ContextPacketService implements IContextPacketService {
  constructor(
    @inject(CHRONICLE_TOKENS.ObserveConfigRepository)
    private readonly _config: IObserveConfigRepository,
    @inject(CHRONICLE_TOKENS.ObservationReceiptRepository)
    private readonly _receipts: IObservationReceiptRepository,
    @inject(CHRONICLE_TOKENS.SourceVaultRepository)
    private readonly _vault: ISourceVaultRepository,
  ) {}

  /** @inheritDoc */
  async assemble(input: ContextPacketInput): Promise<ContextPacket> {
    const started = Date.now();
    const generatedAt = input.now ?? new Date().toISOString();
    const validated = validateContextPacketRequest(input);
    if (!validated.ok) {
      return basePacket(input, generatedAt, {
        status: 'invalid',
        error: validated.error,
      });
    }
    const { budgets, matchMode } = validated;
    const req = validated.input;
    const normalizedSelectors =
      matchMode === 'normalized'
        ? req.selectors.map((s) => normalizeLexicalText(s))
        : undefined;
    if (
      matchMode === 'normalized' &&
      normalizedSelectors?.some((s) => s.length === 0)
    ) {
      return basePacket(req, generatedAt, {
        status: 'invalid',
        error: 'empty-normalized-selector',
        matchMode,
        normalizedSelectors,
      });
    }

    const configRead = await this._config.readResolved(req.dataDir);
    if (!configRead.ok) {
      return basePacket(req, generatedAt, {
        status: configRead.reason === 'missing' ? 'no-config' : 'invalid',
        error: `config-${configRead.reason}`,
        matchMode,
        ...(normalizedSelectors ? { normalizedSelectors } : {}),
      });
    }

    const gate = this.authorizeScopes(configRead.config.scopes, req.scopes);
    if (gate.status !== 'ok') {
      return basePacket(req, generatedAt, {
        status: gate.status,
        error: gate.error,
        matchMode,
        ...(normalizedSelectors ? { normalizedSelectors } : {}),
        limitations: [
          ...MANDATORY_LIMITATIONS,
          ...(gate.limitation ? [gate.limitation] : []),
        ],
      });
    }

    const inventory = await this._receipts.listResolved(
      req.dataDir,
      budgets.maxReceipts,
    );
    const coverage = emptyCoverage();
    coverage.discoveredReceipts = inventory.discovered;
    coverage.invalidReceipts = inventory.invalid;
    coverage.receiptEnumerationComplete = !inventory.truncated;
    if (inventory.truncated || inventory.invalid > 0) {
      coverage.scanComplete = false;
      if (inventory.truncated) {
        coverage.earlyExitReasons.push('receipt-cap');
      }
      if (inventory.invalid > 0) {
        coverage.earlyExitReasons.push('invalid-receipts');
      }
    }

    const allowed = new Set(req.scopes);
    const occurrences: EligibleOccurrence[] = [];
    for (const receipt of inventory.receipts) {
      if (!allowed.has(receipt.scopeId)) continue;
      if (!isConversationShardPath(receipt.sourcePath)) continue;
      occurrences.push({
        scopeId: receipt.scopeId,
        observationId: receipt.observationId,
        contentHash: receipt.contentHash,
        capturedAt: receipt.capturedAt,
        sourcePath: receipt.sourcePath,
      });
    }
    occurrences.sort((a, b) => {
      const keyA = `${a.contentHash}\0${a.scopeId}\0${a.observationId}`;
      const keyB = `${b.contentHash}\0${b.scopeId}\0${b.observationId}`;
      return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
    });
    coverage.eligibleOccurrences = occurrences.length;

    const byHash = new Map<string, EligibleOccurrence[]>();
    for (const occ of occurrences) {
      const list = byHash.get(occ.contentHash) ?? [];
      list.push(occ);
      byHash.set(occ.contentHash, list);
    }
    coverage.discoveredShards = byHash.size;

    const failures: ContextPacketFailure[] = [];
    const candidates: PacketCandidate[] = [];
    const shardNodes = new Map<string, DiagnosticNode[]>();
    const shardTopology = new Map<string, ConversationTopology[]>();
    let scannedBytes = 0;
    const hashes = [...byHash.keys()].sort();

    for (const hash of hashes) {
      if (req.isCancelled?.() === true) {
        return this.cancelled(req, generatedAt, matchMode, normalizedSelectors);
      }
      if (Date.now() - started > budgets.maxElapsedMs) {
        coverage.scanComplete = false;
        coverage.earlyExitReasons.push('elapsed-budget');
        break;
      }
      if (coverage.scannedShards >= budgets.maxShards) {
        coverage.scanComplete = false;
        coverage.earlyExitReasons.push('shard-cap');
        break;
      }
      const group = byHash.get(hash) ?? [];
      const remaining = budgets.maxScanBytes - scannedBytes;
      const verified = await this._vault.getVerified(
        vaultRootOf(req.dataDir),
        hash,
        remaining,
      );
      coverage.scannedShards += 1;
      if (!verified.ok) {
        coverage.failedShards += 1;
        coverage.scanComplete = false;
        failures.push({ class: 'integrity', code: verified.reason });
        continue;
      }
      coverage.verifiedShards += 1;
      scannedBytes += verified.byteLength;
      coverage.scannedBytes = scannedBytes;
      const parsed = parseShardDiagnostics(verified.bytes);
      if (parsed.malformedJson) {
        coverage.failedShards += 1;
        coverage.scanComplete = false;
        failures.push({ class: 'parse', code: 'malformed-shard' });
        continue;
      }
      coverage.unsupportedContentCount += parsed.unsupportedNodes;
      if (parsed.cyclicOrMissingParent) {
        failures.push({ class: 'topology', code: 'cyclic-or-missing-parent' });
      }
      shardNodes.set(hash, parsed.nodes);
      shardTopology.set(hash, parsed.conversations);
      const primary = group[0];
      if (primary === undefined) continue;
      for (const node of parsed.nodes) {
        coverage.scannedNodes += 1;
        if (req.isCancelled?.() === true) {
          return this.cancelled(
            req,
            generatedAt,
            matchMode,
            normalizedSelectors,
          );
        }
        if (
          req.conversationIds &&
          req.conversationIds.length > 0 &&
          !req.conversationIds.includes(node.conversationId)
        ) {
          continue;
        }
        if (
          req.beforeEventTime &&
          node.eventTimeStatus === 'dated' &&
          node.eventTime !== null &&
          node.eventTime >= req.beforeEventTime
        ) {
          continue;
        }
        const matched = matchNodeSelectors(node, req.selectors, matchMode);
        if (matched === null) continue;
        if (candidates.length >= budgets.maxCandidates) {
          coverage.scanComplete = false;
          coverage.earlyExitReasons.push('candidate-cap');
          break;
        }
        candidates.push({
          occurrence: primary,
          node,
          selectorIndexes: matched.indexes,
          reasons: matched.reasons,
          matchStart: matched.start,
          matchLength: matched.length,
          excerptKind: matchMode === 'normalized' ? 'transformed' : 'raw',
        });
      }
      if (coverage.earlyExitReasons.includes('candidate-cap')) break;
    }

    coverage.candidateCount = candidates.length;
    coverage.undatedCount = candidates.filter(
      (c) => c.node.eventTimeStatus !== 'dated',
    ).length;

    const selected = selectPacketEvidence(
      candidates,
      req.selectors.length,
      budgets.maxEvidenceItems,
    );
    const withNeighbors = this.addNeighbors(
      selected.selected,
      shardNodes,
      shardTopology,
      budgets.maxEvidenceItems,
      req.beforeEventTime,
    );

    const items: ContextPacketEvidenceItem[] = withNeighbors.map(
      (candidate, index) => {
        const alternates = (byHash.get(candidate.occurrence.contentHash) ?? [])
          .filter(
            (occ) =>
              occ.scopeId !== candidate.occurrence.scopeId ||
              occ.observationId !== candidate.occurrence.observationId,
          )
          .map((occ) => ({
            scopeId: occ.scopeId,
            observationId: occ.observationId,
            contentHash: occ.contentHash,
          }));
        return toEvidenceItem(
          candidate,
          `e${String(index + 1).padStart(2, '0')}`,
          budgets.maxExcerptChars,
          alternates,
        );
      },
    );

    const limitations: ContextPacketLimitation[] = [...MANDATORY_LIMITATIONS];
    if (selected.unsatisfied.length > 0) {
      limitations.push({
        code: 'unsatisfied-reservation',
        message: `No dated evidence for: ${selected.unsatisfied.join(', ')}`,
      });
    }
    if (candidates.length === 0) {
      limitations.push({
        code: 'no-match',
        message:
          'No lexical matches in the scanned set. That is not no-history.',
      });
    }
    if (req.beforeEventTime) {
      limitations.push({
        code: 'source-time-cutoff',
        message: `Dated nodes at or after ${req.beforeEventTime} were excluded. This is not known-at-time.`,
      });
    }

    const unresolved: ContextPacketUnresolved[] = [
      {
        code: 'source-graph-unresolved',
        message: 'Vault-node refs only. No verified export-membership bridge.',
      },
    ];

    const selectedReasons: Record<string, number> = {};
    for (const item of items) {
      for (const reason of item.reasons) {
        selectedReasons[reason] = (selectedReasons[reason] ?? 0) + 1;
      }
    }

    const serialize = (evidence: ContextPacketEvidenceItem[]): number =>
      Buffer.byteLength(
        JSON.stringify(
          this.finish(
            req,
            generatedAt,
            matchMode,
            normalizedSelectors,
            evidence,
            coverage,
            limitations,
            unresolved,
            failures,
            selectedReasons,
            selected.omissionCounts,
          ),
        ),
        'utf8',
      );

    const bounded = enforcePacketByteBudget(
      items,
      serialize,
      budgets.maxPacketBytes,
    );
    if (bounded.items.length === 0 && items.length > 0) {
      return basePacket(req, generatedAt, {
        status: 'invalid',
        error: 'budget-too-small',
        matchMode,
        ...(normalizedSelectors ? { normalizedSelectors } : {}),
      });
    }
    if (bounded.dropped > 0) {
      coverage.selectionComplete = false;
      coverage.earlyExitReasons.push('packet-byte-budget');
      selected.omissionCounts['packet-byte-budget'] = bounded.dropped;
    }
    coverage.selectedCount = bounded.items.length;
    coverage.omittedCount =
      candidates.length - bounded.items.length + bounded.dropped;

    const assembled = this.finish(
      req,
      generatedAt,
      matchMode,
      normalizedSelectors,
      bounded.items,
      coverage,
      limitations,
      unresolved,
      failures,
      selectedReasons,
      selected.omissionCounts,
    );

    const valid = validateContextPacket(assembled);
    if (!valid.ok) {
      return basePacket(req, generatedAt, {
        status: 'invalid',
        error: 'packet-validation-failed',
        matchMode,
        ...(normalizedSelectors ? { normalizedSelectors } : {}),
        failures: valid.errors.map((code) => ({
          class: 'validation',
          code,
        })),
      });
    }

    const recheck = await this._config.readResolved(req.dataDir);
    if (!recheck.ok) {
      return basePacket(req, generatedAt, {
        status: 'stale-scope',
        error: 'eligibility-changed',
        matchMode,
        ...(normalizedSelectors ? { normalizedSelectors } : {}),
      });
    }
    const reGate = this.authorizeScopes(recheck.config.scopes, req.scopes);
    if (reGate.status !== 'ok') {
      return basePacket(req, generatedAt, {
        status: 'stale-scope',
        error: 'eligibility-changed',
        matchMode,
        ...(normalizedSelectors ? { normalizedSelectors } : {}),
      });
    }

    return assembled;
  }

  private authorizeScopes(
    configured: Array<{ id: string; forgotten: boolean }>,
    requested: string[],
  ): {
    status: 'ok' | 'not-found' | 'withheld';
    error?: string;
    limitation?: ContextPacketLimitation;
  } {
    for (const id of requested) {
      const found = configured.find((scope) => scope.id === id);
      if (found === undefined) {
        return { status: 'not-found', error: 'unknown-scope' };
      }
      if (found.forgotten) {
        return {
          status: 'withheld',
          error: 'forgotten-scope',
          limitation: {
            code: 'forgotten-scope-withheld',
            message: 'A requested scope is forgotten. No evidence returned.',
          },
        };
      }
    }
    return { status: 'ok' };
  }

  private addNeighbors(
    selected: PacketCandidate[],
    shardNodes: Map<string, DiagnosticNode[]>,
    shardTopology: Map<string, ConversationTopology[]>,
    budget: number,
    beforeEventTime?: string,
  ): PacketCandidate[] {
    const out = [...selected];
    const seen = new Set(
      selected.map((c) =>
        occurrenceKey(c.occurrence, c.node.conversationId, c.node.nodeId),
      ),
    );
    for (const candidate of selected) {
      if (out.length >= budget) break;
      const nodes = shardNodes.get(candidate.occurrence.contentHash) ?? [];
      const topologies =
        shardTopology.get(candidate.occurrence.contentHash) ?? [];
      const topo = topologies.find(
        (t) => t.conversationId === candidate.node.conversationId,
      );
      const neighbors = neighborNodes(
        nodes,
        candidate.node,
        topo?.mapping,
        topo?.currentNode,
      );
      const extras: DiagnosticNode[] = [];
      if (neighbors.parent) extras.push(neighbors.parent);
      if (neighbors.child) extras.push(neighbors.child);
      for (const node of extras) {
        if (out.length >= budget) break;
        if (
          beforeEventTime !== undefined &&
          node.eventTimeStatus === 'dated' &&
          node.eventTime !== null &&
          node.eventTime >= beforeEventTime
        ) {
          continue;
        }
        const key = occurrenceKey(
          candidate.occurrence,
          node.conversationId,
          node.nodeId,
        );
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          occurrence: candidate.occurrence,
          node,
          selectorIndexes: [],
          reasons: ['structural-neighbor'],
          matchStart: 0,
          matchLength: Math.min(node.text.length, 1),
          excerptKind: 'raw',
        });
      }
    }
    return out;
  }

  private cancelled(
    req: ContextPacketInput,
    generatedAt: string,
    matchMode: ContextPacket['matchMode'],
    normalizedSelectors: string[] | undefined,
  ): ContextPacket {
    return basePacket(req, generatedAt, {
      status: 'partial',
      error: 'cancelled',
      matchMode,
      ...(normalizedSelectors ? { normalizedSelectors } : {}),
      coverage: {
        ...emptyCoverage(),
        scanComplete: false,
        earlyExitReasons: ['cancelled'],
      },
    });
  }

  private finish(
    req: ContextPacketInput,
    generatedAt: string,
    matchMode: ContextPacket['matchMode'],
    normalizedSelectors: string[] | undefined,
    evidence: ContextPacketEvidenceItem[],
    coverage: ContextPacketCoverage,
    limitations: ContextPacketLimitation[],
    unresolved: ContextPacketUnresolved[],
    failures: ContextPacketFailure[],
    selectedReasons: Record<string, number>,
    omissionCounts: Record<string, number>,
  ): ContextPacket {
    const partial =
      !coverage.scanComplete ||
      !coverage.selectionComplete ||
      !coverage.receiptEnumerationComplete ||
      coverage.failedShards > 0 ||
      coverage.invalidReceipts > 0;
    return {
      schemaVersion: CONTEXT_PACKET_SCHEMA_VERSION,
      policy: packetPolicy(),
      status: partial ? 'partial' : 'ok',
      generatedAt,
      sourceTimeSemantics: 'vendor-create-time',
      identityResolution: 'not-performed',
      conceptOrigin: 'not-established',
      scopes: req.scopes,
      matchMode,
      selectors: req.selectors,
      ...(normalizedSelectors ? { normalizedSelectors } : {}),
      ...(req.utterance !== undefined ? { utterance: req.utterance } : {}),
      evidence,
      coverage,
      limitations,
      unresolved,
      failures,
      audit: {
        complete: coverage.receiptEnumerationComplete && coverage.scanComplete,
        policyId: packetPolicy().id,
        policyVersion: packetPolicy().version,
        selectorCount: req.selectors.length,
        matchMode,
        scopeCount: req.scopes.length,
        stageCounts: {
          eligibleOccurrences: coverage.eligibleOccurrences,
          scannedShards: coverage.scannedShards,
          candidates: coverage.candidateCount,
          selected: evidence.length,
        },
        omissionCounts,
        selectedReasons,
      },
    };
  }
}
