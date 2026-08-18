import { CandidateObservationPayload } from '../types';
import { CANDIDATE_OBSERVATION_SCHEMA } from './interpretation-policy.utils';

const SUPPORTED = new Set(['directly-supported', 'inferred']);

const stripFence = (text: string): string => {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? (match[1] ?? '').trim() : trimmed;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === 'string' && item.length > 0)) {
    return null;
  }
  return value as string[];
};

const citedAllowed = (cited: string[], allowed: Set<string>): boolean =>
  cited.every((id) => allowed.has(id));

/**
 * Parse a model body into durable per-observation payloads.
 * The model may return a bundle; each payload is exactly one result.
 */
export const parseCandidateObservationOutput = (
  text: string,
  allowedNodeIds: string[],
): { payloads: CandidateObservationPayload[] } | { error: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(text));
  } catch {
    return { error: 'invalid-output:not-json' };
  }
  if (!isRecord(parsed)) return { error: 'invalid-output:not-object' };
  const allowed = new Set(allowedNodeIds);
  const result = parsed['result'];
  if (result === 'insufficient-evidence') {
    const citedNodeIds = asStringArray(parsed['citedNodeIds']);
    if (!citedNodeIds) return { error: 'invalid-output:cited-node-ids' };
    if (!citedAllowed(citedNodeIds, allowed)) {
      return { error: 'invalid-output:cited-node-unknown' };
    }
    if (parsed['observations'] != null) {
      return { error: 'invalid-output:mixed-result' };
    }
    const payload: CandidateObservationPayload = {
      schemaVersion: CANDIDATE_OBSERVATION_SCHEMA,
      result: 'insufficient-evidence',
      citedNodeIds: [...citedNodeIds],
      ...(typeof parsed['supportNote'] === 'string'
        ? { supportNote: parsed['supportNote'] }
        : {}),
    };
    return { payloads: [payload] };
  }
  if (result !== 'observations') {
    return { error: 'invalid-output:unknown-result' };
  }
  const observations = parsed['observations'];
  if (!Array.isArray(observations) || observations.length === 0) {
    return { error: 'invalid-output:observations-missing' };
  }
  if (observations.length > 3) {
    return { error: 'invalid-output:too-many-observations' };
  }
  const payloads: CandidateObservationPayload[] = [];
  for (const item of observations) {
    if (!isRecord(item)) return { error: 'invalid-output:observation-shape' };
    const statement = item['statement'];
    const epistemicClass = item['epistemicClass'];
    const citedNodeIds = asStringArray(item['citedNodeIds']);
    if (typeof statement !== 'string' || !statement.trim()) {
      return { error: 'invalid-output:statement-missing' };
    }
    if (typeof epistemicClass !== 'string' || !SUPPORTED.has(epistemicClass)) {
      return { error: 'invalid-output:epistemic-class' };
    }
    if (!citedNodeIds) return { error: 'invalid-output:cited-node-ids' };
    if (!citedAllowed(citedNodeIds, allowed)) {
      return { error: 'invalid-output:cited-node-unknown' };
    }
    payloads.push({
      schemaVersion: CANDIDATE_OBSERVATION_SCHEMA,
      result: 'observation',
      statement: statement.trim(),
      epistemicClass: epistemicClass as 'directly-supported' | 'inferred',
      citedNodeIds: [...citedNodeIds],
      ...(typeof item['supportNote'] === 'string'
        ? { supportNote: item['supportNote'] }
        : {}),
    });
  }
  return { payloads };
};

export const serializeCandidateObservation = (
  payload: CandidateObservationPayload,
): string => JSON.stringify(payload);

export const epistemicClassOf = (
  payload: CandidateObservationPayload,
): string =>
  payload.result === 'insufficient-evidence'
    ? 'insufficient-evidence'
    : payload.epistemicClass;
