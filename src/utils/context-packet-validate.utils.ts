import {
  CONTEXT_PACKET_POLICY_ID,
  CONTEXT_PACKET_POLICY_VERSION,
  CONTEXT_PACKET_SCHEMA_VERSION,
  ContextPacket,
  ContextPacketEvidenceItem,
} from '../types';
import { isRecord } from './chatgpt-export.utils';

const HASH = /^[a-f0-9]{64}$/;

const REQUIRED_LIMITATION_CODES = [
  'identity-resolution-not-performed',
  'concept-origin-not-established',
  'expression-is-not-endorsement',
] as const;

export type PacketValidation = { ok: true } | { ok: false; errors: string[] };

const isEvidenceItem = (value: unknown): value is ContextPacketEvidenceItem => {
  if (!isRecord(value)) return false;
  const ref = value['ref'];
  if (!isRecord(ref)) return false;
  return (
    typeof value['handle'] === 'string' &&
    ref['kind'] === 'vault-node' &&
    typeof ref['scopeId'] === 'string' &&
    typeof ref['observationId'] === 'string' &&
    typeof ref['contentHash'] === 'string' &&
    HASH.test(ref['contentHash']) &&
    typeof ref['conversationId'] === 'string' &&
    typeof ref['nodeId'] === 'string' &&
    typeof value['role'] === 'string' &&
    Array.isArray(value['reasons']) &&
    Array.isArray(value['selectorIndexes']) &&
    typeof value['excerpt'] === 'string'
  );
};

/**
 * Runtime validator for a context packet. Rejects missing provenance,
 * forged hash syntax, unsupported schema versions, and omitted
 * mandatory cautions.
 */
export const validateContextPacket = (value: unknown): PacketValidation => {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['not-an-object'] };
  if (value['schemaVersion'] !== CONTEXT_PACKET_SCHEMA_VERSION) {
    errors.push('unsupported-schema-version');
  }
  const policy = value['policy'];
  if (
    !isRecord(policy) ||
    policy['id'] !== CONTEXT_PACKET_POLICY_ID ||
    policy['version'] !== CONTEXT_PACKET_POLICY_VERSION
  ) {
    errors.push('unsupported-policy');
  }
  if (value['identityResolution'] !== 'not-performed') {
    errors.push('missing-identity-resolution-caution');
  }
  if (value['conceptOrigin'] !== 'not-established') {
    errors.push('missing-concept-origin-caution');
  }
  if (!Array.isArray(value['limitations'])) {
    errors.push('missing-limitations');
  } else {
    const codes = value['limitations']
      .filter(isRecord)
      .map((item) => item['code']);
    for (const required of REQUIRED_LIMITATION_CODES) {
      if (!codes.includes(required)) {
        errors.push(`missing-limitation:${required}`);
      }
    }
  }
  if (!Array.isArray(value['evidence'])) {
    errors.push('missing-evidence-array');
  } else {
    value['evidence'].forEach((item, index) => {
      if (!isEvidenceItem(item)) {
        errors.push(`invalid-evidence:${index}`);
      }
    });
  }
  if (!isRecord(value['coverage'])) {
    errors.push('missing-coverage');
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
};

export const isContextPacket = (value: unknown): value is ContextPacket =>
  validateContextPacket(value).ok;
