import {
  isChronicleLedgerCommit,
  dailyLedgerCommitSubject,
  dailyLedgerCommitTrailers,
} from '../utils/commit.utils';

describe('isChronicleLedgerCommit', () => {
  it.each([
    'chronicle(daily): 2026-07-31',
    'chronicle(queue): close item q-123',
    'chronicle(ingest): ext:acme/deploy-bot batch',
    'chronicle: bare-type ledger write',
    'chronicle(daily)!: breaking ledger format change',
  ])('matches the chronicle type: %s', (subject) => {
    expect(isChronicleLedgerCommit(subject)).toBe(true);
  });

  it('matches the legacy pre-ADR-0007 daily subject', () => {
    expect(isChronicleLedgerCommit('chore: daily chronicle 2026-07-22')).toBe(
      true,
    );
  });

  it.each([
    'feat: add chronicle git source adapter',
    'feat(chronicle): product code change scoped to chronicle',
    'fix: correct meeting note',
    'chore: daily chores list',
    'chronicles: not the reserved type',
    'chronicle missing the colon',
  ])('does not match ordinary commits: %s', (subject) => {
    expect(isChronicleLedgerCommit(subject)).toBe(false);
  });
});

describe('daily ledger commit composition', () => {
  it('composes the chronicle(daily) subject from the window date', () => {
    expect(dailyLedgerCommitSubject('2026-07-31')).toBe(
      'chronicle(daily): 2026-07-31',
    );
  });

  it('composes the mandatory provenance trailers', () => {
    expect(dailyLedgerCommitTrailers('2026-07-31', '0.1.0')).toBe(
      'Chronicle-Window: 2026-07-31\nGenerated-By: chronicle@0.1.0',
    );
  });

  it('subjects it composes are recognized by the self-exclusion predicate', () => {
    expect(
      isChronicleLedgerCommit(dailyLedgerCommitSubject('2026-07-31')),
    ).toBe(true);
  });
});
