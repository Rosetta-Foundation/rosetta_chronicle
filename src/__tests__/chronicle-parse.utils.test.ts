import { parseExistingTags, parseExistingNotes } from '../utils/chronicle-parse.utils';

const SAMPLE = `# Daily Chronicle

_2026-07-22_

## Executive Summary

5 commits, 3 Claude sessions, 2 notes recorded across the day.

## Work Completed

- feat: add thing _(abc12345)_

## Claude Sessions

- Build the feature

## Notes & Discussions

- discussed federation architecture with Vinay
- decided repos should be private-by-default

## Suggested Tags

\`[DELIVERY]\` \`[CROSS-TEAM]\` \`[ARCH]\` \`[SECURITY]\` \`[LEVERAGE]\`
`;

describe('parseExistingTags', () => {
  it('extracts all tags present in the Suggested Tags line', () => {
    expect(parseExistingTags(SAMPLE)).toEqual([
      'DELIVERY', 'CROSS-TEAM', 'ARCH', 'SECURITY', 'LEVERAGE',
    ]);
  });

  it('returns empty array when no tags section is present', () => {
    expect(parseExistingTags('# Daily Chronicle\n\n_No tags here._\n')).toEqual([]);
  });

  it('ignores unknown tag-shaped tokens', () => {
    const md = '## Suggested Tags\n\n`[DELIVERY]` `[NOTREAL]`\n';
    expect(parseExistingTags(md)).toEqual(['DELIVERY']);
  });

  it('deduplicates repeated tags', () => {
    const md = '## Suggested Tags\n\n`[ARCH]` `[ARCH]`\n';
    expect(parseExistingTags(md)).toEqual(['ARCH']);
  });
});

describe('parseExistingNotes', () => {
  it('extracts note lines from the Notes & Discussions section', () => {
    expect(parseExistingNotes(SAMPLE)).toEqual([
      'discussed federation architecture with Vinay',
      'decided repos should be private-by-default',
    ]);
  });

  it('returns empty array when no Notes section is present', () => {
    expect(parseExistingNotes('# Daily Chronicle\n\n## Suggested Tags\n\n`[ARCH]`\n')).toEqual([]);
  });

  it('stops at the next section heading', () => {
    const md = `## Notes & Discussions\n\n- note one\n- note two\n\n## Suggested Tags\n\n- should not appear\n`;
    expect(parseExistingNotes(md)).toEqual(['note one', 'note two']);
  });

  it('strips bullet prefixes', () => {
    const md = `## Notes & Discussions\n\n* starred note\n- dashed note\nplain note\n`;
    expect(parseExistingNotes(md)).toEqual(['starred note', 'dashed note', 'plain note']);
  });
});
