import { checkClobber, describeDropped } from '../utils/clobber.utils';
import { Activity } from '../types';

const act = (id: string, over: Partial<Activity> = {}): Activity => ({
  source: 'git',
  id,
  timestamp: '2026-07-23T10:00:00Z',
  summary: `commit ${id}`,
  evidence: [{ source: 'git', ref: id, description: id }],
  ...over,
});

describe('checkClobber', () => {
  it('no prior activity → never clobbers', () => {
    const r = checkClobber([act('a'), act('b')], []);
    expect(r.wouldClobber).toBe(false);
    expect(r.dropped).toEqual([]);
  });

  it('identical sets → no clobber, nothing dropped', () => {
    const r = checkClobber([act('a'), act('b')], [act('a'), act('b')]);
    expect(r.wouldClobber).toBe(false);
    expect(r.dropped).toEqual([]);
  });

  it('superset (fresh adds activity) → no clobber', () => {
    const r = checkClobber([act('a'), act('b'), act('c')], [act('a'), act('b')]);
    expect(r.wouldClobber).toBe(false);
    expect(r.dropped).toEqual([]);
  });

  it('strict subset (fresh drops activity, adds nothing) → clobber', () => {
    const r = checkClobber([act('a')], [act('a'), act('b')]);
    expect(r.wouldClobber).toBe(true);
    expect(r.dropped.map((a) => a.id)).toEqual(['b']);
  });

  it('overlap with both drops and adds → NOT a clobber (something new offsets it)', () => {
    // fresh has {a,c}, prior has {a,b}: b dropped, but c is new → not a pure regression
    const r = checkClobber([act('a'), act('c')], [act('a'), act('b')]);
    expect(r.wouldClobber).toBe(false);
    expect(r.dropped.map((a) => a.id)).toEqual(['b']); // still reported
  });

  it('empty fresh against non-empty prior → clobber, all dropped', () => {
    const r = checkClobber([], [act('a'), act('b')]);
    expect(r.wouldClobber).toBe(true);
    expect(r.dropped).toHaveLength(2);
  });
});

describe('describeDropped', () => {
  it('includes source and summary', () => {
    expect(describeDropped(act('a', { summary: 'feat: x' }))).toContain('feat: x');
    expect(describeDropped(act('a'))).toContain('(git)');
  });

  it('includes repo when present', () => {
    const line = describeDropped(act('a', { repo: 'my-repo' }));
    expect(line).toContain('[my-repo]');
  });

  it('handles non-git sources', () => {
    const line = describeDropped(
      act('s1', { source: 'claude-code', summary: 'Investigate X' }),
    );
    expect(line).toContain('(claude-code)');
    expect(line).toContain('Investigate X');
  });
});
