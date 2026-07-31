import { inferTags, ALL_TAGS } from '../utils/tags.utils';
import { Activity } from '../types';

const activity = (summary: string): Activity => ({
  source: 'git',
  id: summary,
  timestamp: '2026-07-21T00:00:00Z',
  summary,
  evidence: [],
});

describe('inferTags', () => {
  it('returns no tags for empty activity', () => {
    expect(inferTags([])).toEqual([]);
  });

  it('maps conventional-commit prefixes to tags', () => {
    expect(inferTags([activity('feat: add dashboard filters')])).toContain('DELIVERY');
    expect(inferTags([activity('fix: handle empty commit ranges')])).toContain('RELIABILITY');
    expect(inferTags([activity('perf: cache token lookups')])).toContain('PERFORMANCE');
  });

  it('detects security/auth topics', () => {
    expect(inferTags([activity('wire up Entra/Okta federation')])).toContain('SECURITY');
  });

  it('detects leverage/automation topics', () => {
    expect(inferTags([activity('add reusable workflow template')])).toContain('LEVERAGE');
  });

  it('deduplicates and returns tags in taxonomy order', () => {
    const result = inferTags([
      activity('feat: ship it'),
      activity('feat: ship more'),
      activity('test: add coverage'),
    ]);
    // DELIVERY (feat) before DEV (test), per ALL_TAGS order; no duplicate DELIVERY.
    expect(result).toEqual([...ALL_TAGS].filter((t) => t === 'DELIVERY' || t === 'DEV'));
  });

  it('returns nothing for summaries that match no pattern', () => {
    expect(inferTags([activity('wip')])).toEqual([]);
  });
});
