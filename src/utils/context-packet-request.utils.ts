import {
  CONTEXT_PACKET_POLICY_ID,
  CONTEXT_PACKET_POLICY_VERSION,
  CONTEXT_PACKET_SCHEMA_VERSION,
  ContextPacketBudgets,
  ContextPacketInput,
  ContextPacketLimitation,
  ContextPacketMatchMode,
} from '../types';

export const DEFAULT_CONTEXT_PACKET_BUDGETS: ContextPacketBudgets = {
  maxEvidenceItems: 12,
  maxExcerptChars: 600,
  maxPacketBytes: 32 * 1024,
  maxScanBytes: 128 * 1024 * 1024,
  maxShards: 256,
  maxElapsedMs: 5000,
  maxReceipts: 4096,
  maxCandidates: 10000,
};

const MAX_SELECTORS = 8;
const MAX_SCOPES = 32;

export const MANDATORY_LIMITATIONS: ContextPacketLimitation[] = [
  {
    code: 'identity-resolution-not-performed',
    message:
      'Lexical occurrence is not identity resolution. Mentions stay separate.',
  },
  {
    code: 'concept-origin-not-established',
    message: 'Earliest dated match in the scanned set is not a concept origin.',
  },
  {
    code: 'expression-is-not-endorsement',
    message: 'Evidence of expression is not evidence of truth or endorsement.',
  },
];

const isMatchMode = (value: unknown): value is ContextPacketMatchMode =>
  value === 'raw' || value === 'normalized';

const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isPositiveIntAtLeastOne = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;

export type RequestValidation =
  | {
      ok: true;
      input: Required<
        Pick<ContextPacketInput, 'dataDir' | 'scopes' | 'selectors'>
      > &
        ContextPacketInput;
      budgets: ContextPacketBudgets;
      matchMode: ContextPacketMatchMode;
    }
  | { ok: false; error: string };

/**
 * Validate a packet request before any vault read. Rejects nonfinite
 * or fractional budget overrides and empty selectors/scopes.
 */
export const validateContextPacketRequest = (
  input: ContextPacketInput,
): RequestValidation => {
  const dataDir = input.dataDir.trim();
  if (dataDir.length === 0) {
    return { ok: false, error: 'missing-data-dir' };
  }
  if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
    return { ok: false, error: 'missing-scopes' };
  }
  if (input.scopes.length > MAX_SCOPES) {
    return { ok: false, error: 'too-many-scopes' };
  }
  const scopes: string[] = [];
  for (const scope of input.scopes) {
    if (typeof scope !== 'string' || scope.trim().length === 0) {
      return { ok: false, error: 'empty-scope' };
    }
    scopes.push(scope.trim());
  }
  if (!Array.isArray(input.selectors) || input.selectors.length === 0) {
    return { ok: false, error: 'missing-selectors' };
  }
  if (input.selectors.length > MAX_SELECTORS) {
    return { ok: false, error: 'too-many-selectors' };
  }
  const selectors: string[] = [];
  for (const selector of input.selectors) {
    if (typeof selector !== 'string' || selector.trim().length === 0) {
      return { ok: false, error: 'empty-selector' };
    }
    selectors.push(selector);
  }
  const matchMode = input.matchMode ?? 'raw';
  if (!isMatchMode(matchMode)) {
    return { ok: false, error: 'unknown-match-mode' };
  }
  if (
    input.beforeEventTime !== undefined &&
    (Number.isNaN(Date.parse(input.beforeEventTime)) ||
      !Number.isFinite(Date.parse(input.beforeEventTime)))
  ) {
    return { ok: false, error: 'invalid-before-event-time' };
  }
  const budgets = mergeBudgets(input.budgets);
  if (!budgets.ok) return budgets;
  return {
    ok: true,
    input: { ...input, dataDir, scopes, selectors, matchMode },
    budgets: budgets.budgets,
    matchMode,
  };
};

const mergeBudgets = (
  overrides: Partial<ContextPacketBudgets> | undefined,
):
  | { ok: true; budgets: ContextPacketBudgets }
  | { ok: false; error: string } => {
  const budgets = { ...DEFAULT_CONTEXT_PACKET_BUDGETS };
  if (overrides === undefined) return { ok: true, budgets };
  const keys = Object.keys(overrides) as (keyof ContextPacketBudgets)[];
  for (const key of keys) {
    const value = overrides[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, error: 'invalid-budget' };
    }
    if (!Number.isInteger(value) || value < 0) {
      return { ok: false, error: 'invalid-budget' };
    }
    if (
      (key === 'maxEvidenceItems' ||
        key === 'maxExcerptChars' ||
        key === 'maxPacketBytes') &&
      !isPositiveIntAtLeastOne(value)
    ) {
      return { ok: false, error: 'invalid-budget' };
    }
    if (
      key !== 'maxEvidenceItems' &&
      key !== 'maxExcerptChars' &&
      key !== 'maxPacketBytes' &&
      !isPositiveInt(value)
    ) {
      return { ok: false, error: 'invalid-budget' };
    }
    budgets[key] = value;
  }
  return { ok: true, budgets };
};

/**
 * Parse a `--request` JSON object. The file authorizes reading that
 * file, not expanding scopes. Contents are not persisted.
 */
export const parseContextPacketRequestFile = (
  raw: unknown,
): RequestValidation => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'invalid-request-json' };
  }
  const rec = raw as Record<string, unknown>;
  if (
    rec['schemaVersion'] !== undefined &&
    rec['schemaVersion'] !== CONTEXT_PACKET_SCHEMA_VERSION
  ) {
    return { ok: false, error: 'unsupported-schema-version' };
  }
  if (rec['matchMode'] !== undefined && !isMatchMode(rec['matchMode'])) {
    return { ok: false, error: 'unknown-match-mode' };
  }
  if (typeof rec['dataDir'] !== 'string') {
    return { ok: false, error: 'missing-data-dir' };
  }
  if (!Array.isArray(rec['scopes'])) {
    return { ok: false, error: 'missing-scopes' };
  }
  if (!Array.isArray(rec['selectors'])) {
    return { ok: false, error: 'missing-selectors' };
  }
  const conversationIds = Array.isArray(rec['conversationIds'])
    ? rec['conversationIds'].filter(
        (id): id is string => typeof id === 'string',
      )
    : undefined;
  const budgets =
    rec['budgets'] !== undefined &&
    rec['budgets'] !== null &&
    typeof rec['budgets'] === 'object' &&
    !Array.isArray(rec['budgets'])
      ? (rec['budgets'] as Partial<ContextPacketBudgets>)
      : undefined;
  return validateContextPacketRequest({
    dataDir: rec['dataDir'],
    scopes: rec['scopes'] as string[],
    selectors: rec['selectors'] as string[],
    ...(typeof rec['utterance'] === 'string'
      ? { utterance: rec['utterance'] }
      : {}),
    ...(isMatchMode(rec['matchMode']) ? { matchMode: rec['matchMode'] } : {}),
    ...(conversationIds && conversationIds.length > 0
      ? { conversationIds }
      : {}),
    ...(typeof rec['beforeEventTime'] === 'string'
      ? { beforeEventTime: rec['beforeEventTime'] }
      : {}),
    ...(budgets ? { budgets } : {}),
  });
};

export const packetPolicy = (): { id: string; version: string } => ({
  id: CONTEXT_PACKET_POLICY_ID,
  version: CONTEXT_PACKET_POLICY_VERSION,
});
