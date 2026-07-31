/**
 * Pure helpers for Chronicle's machine-authored ledger commits (ADR-0007).
 * No I/O, no DI.
 */

/** The Conventional Commit type reserved for machine-authored ledger commits. */
export const CHRONICLE_COMMIT_TYPE = 'chronicle';

/** Matches any `chronicle` type subject: `chronicle: …`, `chronicle(daily): …`. */
const CHRONICLE_TYPE_RE = /^chronicle(\([^)]*\))?!?: /;

/**
 * Subject emitted before ADR-0007 introduced the dedicated type. Matched during
 * the deprecation window so legacy ledger history stays excluded.
 */
const LEGACY_DAILY_RE = /^chore: daily chronicle\b/;

/**
 * Whether a commit subject identifies a machine-authored ledger commit —
 * Chronicle writing its own memory. Activity collection must never ingest
 * these (ADR-0007's self-exclusion protocol): Chronicle does not chronicle
 * itself, regardless of which repository the commit lives in.
 */
export const isChronicleLedgerCommit = (subject: string): boolean =>
  CHRONICLE_TYPE_RE.test(subject) || LEGACY_DAILY_RE.test(subject);

/** Compose the subject line for a daily ledger commit, e.g. `chronicle(daily): 2026-07-31`. */
export const dailyLedgerCommitSubject = (date: string): string =>
  `${CHRONICLE_COMMIT_TYPE}(daily): ${date}`;

/**
 * Compose the provenance trailer block for a daily ledger commit (ADR-0007):
 * `Chronicle-Window:` + `Generated-By:`, both mandatory on every
 * `chronicle:` commit. Passed to git as a second `-m`, which git separates
 * from the subject with a blank line — making the trailers parseable by
 * `git interpret-trailers`.
 */
export const dailyLedgerCommitTrailers = (
  date: string,
  engineVersion: string,
): string =>
  `Chronicle-Window: ${date}\nGenerated-By: chronicle@${engineVersion}`;
