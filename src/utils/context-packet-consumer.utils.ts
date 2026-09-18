import { ContextPacket } from '../types';

export type ConsumerClaimKind =
  'global-origin' | 'same-person' | 'user-endorsement' | 'backdated-meaning';

export interface ConsumerClaim {
  kind: ConsumerClaimKind;
  /** Handles the claim cites. Empty means an unsupported assertion. */
  evidenceHandles?: string[];
}

export type ConsumerValidation = { ok: true } | { ok: false; reason: string };

const itemByHandle = (packet: ContextPacket, handle: string) =>
  packet.evidence.find((item) => item.handle === handle);

/**
 * Deterministic consumer contract. Rejects origin, identity-merge,
 * endorsement, and backdating claims unless the cited packet items
 * actually support them. This is not a model-quality test.
 */
export const validateConsumerClaims = (
  packet: ContextPacket,
  claims: ConsumerClaim[],
): ConsumerValidation => {
  for (const claim of claims) {
    const handles = claim.evidenceHandles ?? [];
    if (handles.length === 0) {
      return { ok: false, reason: `unsupported-claim:${claim.kind}` };
    }
    const items = handles.map((handle) => itemByHandle(packet, handle));
    if (items.some((item) => item === undefined)) {
      return { ok: false, reason: `unknown-handle:${claim.kind}` };
    }
    if (claim.kind === 'global-origin') {
      return { ok: false, reason: 'concept-origin-not-established' };
    }
    if (claim.kind === 'same-person') {
      return { ok: false, reason: 'identity-resolution-not-performed' };
    }
    if (claim.kind === 'user-endorsement') {
      const userOwnsAssistantPhrase = items.some(
        (item) => item !== undefined && item.role === 'user',
      );
      if (userOwnsAssistantPhrase) {
        return { ok: false, reason: 'user-role-is-not-endorsement' };
      }
      return { ok: false, reason: 'expression-is-not-endorsement' };
    }
    if (claim.kind === 'backdated-meaning') {
      return {
        ok: false,
        reason: 'later-significance-is-not-earlier-knowledge',
      };
    }
  }
  return { ok: true };
};
