import {
  parseTags,
  parseTitle,
  queueItemId,
  parseQueue,
  renderItem,
  serializeQueue,
  prioritizeNext,
  formatQueueSummary,
} from '../utils/queue.utils';
import { QueueItem } from '../types';

const makeItem = (overrides: Partial<QueueItem> = {}): QueueItem => ({
  id: 'aabbccddee11',
  title: 'Do the thing',
  state: 'inbox',
  refs: [],
  signals: [],
  addedAt: '2026-07-24T00:00:00.000Z',
  ...overrides,
});

// ─── parseTags ────────────────────────────────────────────────────────────────

describe('parseTags', () => {
  it('extracts a jira ref', () => {
    const { refs } = parseTags('Fix the widget [jira:PROJ-72]');
    expect(refs).toEqual([{ type: 'jira', key: 'PROJ-72' }]);
  });

  it('extracts a prd ref', () => {
    const { refs } = parseTags('[prd:0007/1]');
    expect(refs).toEqual([{ type: 'prd', key: '0007/1' }]);
  });

  it('extracts a due signal', () => {
    const { signals } = parseTags('[due:2026-07-28]');
    expect(signals).toEqual([{ type: 'due', value: '2026-07-28' }]);
  });

  it('extracts a blocked signal', () => {
    const { signals } = parseTags('[blocked:waiting on design]');
    expect(signals).toEqual([{ type: 'blocked', value: 'waiting on design' }]);
  });

  it('handles follow-up and idea refs', () => {
    const { refs } = parseTags('[follow-up:yes] [idea:explore caching]');
    expect(refs).toEqual([
      { type: 'follow-up', key: 'yes' },
      { type: 'idea', key: 'explore caching' },
    ]);
  });

  it('returns empty arrays for a plain title', () => {
    const { refs, signals } = parseTags('No tags here');
    expect(refs).toEqual([]);
    expect(signals).toEqual([]);
  });
});

// ─── parseTitle ───────────────────────────────────────────────────────────────

describe('parseTitle', () => {
  it('strips unchecked checkbox prefix', () => {
    expect(parseTitle('- [ ] Ship the feature')).toBe('Ship the feature');
  });

  it('strips checked checkbox prefix', () => {
    expect(parseTitle('- [x] Done item')).toBe('Done item');
  });

  it('strips inline tags', () => {
    expect(parseTitle('- [ ] Fix bug [jira:PROJ-1] [due:2026-07-30]')).toBe('Fix bug');
  });

  it('strips done-arrow suffix', () => {
    expect(parseTitle('- [x] Finished → 2026-07-24')).toBe('Finished');
  });
});

// ─── queueItemId ──────────────────────────────────────────────────────────────

describe('queueItemId', () => {
  it('returns a 12-char hex string', () => {
    const id = queueItemId('some title');
    expect(id).toHaveLength(12);
    expect(/^[0-9a-f]+$/.test(id)).toBe(true);
  });

  it('is case-insensitive and trimmed', () => {
    expect(queueItemId('Hello')).toBe(queueItemId('hello'));
    expect(queueItemId('  hello  ')).toBe(queueItemId('hello'));
  });

  it('is stable', () => {
    expect(queueItemId('my task')).toBe(queueItemId('my task'));
  });
});

// ─── parseQueue ───────────────────────────────────────────────────────────────

describe('parseQueue', () => {
  it('parses items from each section', () => {
    const md = `
## Active
- [ ] Currently doing this

## Next Up
- [ ] Plan the next thing [due:2026-07-25]

## Inbox
- [ ] Unsorting pile

## Done
- [x] Already done → 2026-07-23
`.trim();
    const items = parseQueue(md);
    expect(items).toHaveLength(4);
    expect(items[0].state).toBe('active');
    expect(items[1].state).toBe('next');
    expect(items[2].state).toBe('inbox');
    expect(items[3].state).toBe('done');
  });

  it('attaches due signal', () => {
    const md = `## Next Up\n- [ ] Ship it [due:2026-07-28]`;
    const [item] = parseQueue(md);
    expect(item.signals).toEqual([{ type: 'due', value: '2026-07-28' }]);
  });

  it('forces done state for checked items regardless of section', () => {
    const md = `## Active\n- [x] Was active but checked off`;
    const [item] = parseQueue(md);
    expect(item.state).toBe('done');
  });

  it('extracts closedAt from done-arrow', () => {
    const md = `## Done\n- [x] Old task → 2026-07-20`;
    const [item] = parseQueue(md);
    expect(item.closedAt).toBe('2026-07-20T00:00:00');
  });

  it('skips blank lines and headings', () => {
    const md = `# Work Queue\n\n## Inbox\n\n- [ ] Only item\n`;
    const items = parseQueue(md);
    expect(items).toHaveLength(1);
  });

  it('uses jira key as stable id when present', () => {
    const md = `## Inbox\n- [ ] Fix bug [jira:PROJ-72]`;
    const [item] = parseQueue(md);
    expect(item.id).toBe(queueItemId('PROJ-72'));
  });
});

// ─── renderItem ───────────────────────────────────────────────────────────────

describe('renderItem', () => {
  it('renders an unchecked inbox item', () => {
    const item = makeItem({ title: 'My task' });
    expect(renderItem(item)).toBe('- [ ] My task');
  });

  it('renders a done item with closedAt', () => {
    const item = makeItem({
      state: 'done',
      closedAt: '2026-07-24T10:00:00',
    });
    expect(renderItem(item)).toBe('- [x] Do the thing → 2026-07-24');
  });

  it('renders tags', () => {
    const item = makeItem({
      refs: [{ type: 'jira', key: 'PROJ-1' }],
      signals: [{ type: 'due', value: '2026-07-30' }],
    });
    expect(renderItem(item)).toBe('- [ ] Do the thing [jira:PROJ-1] [due:2026-07-30]');
  });
});

// ─── serializeQueue ───────────────────────────────────────────────────────────

describe('serializeQueue', () => {
  it('omits Done section when empty', () => {
    const items = [makeItem({ state: 'active' })];
    const out = serializeQueue(items);
    expect(out).not.toContain('## Done');
  });

  it('includes Done section when not empty', () => {
    const items = [makeItem({ state: 'done', closedAt: '2026-07-24T00:00:00' })];
    const out = serializeQueue(items);
    expect(out).toContain('## Done');
  });

  it('emits <!-- empty --> placeholder for empty sections', () => {
    const items = [makeItem({ state: 'active' })];
    const out = serializeQueue(items);
    expect(out).toContain('<!-- empty -->');
  });

  it('round-trips through parseQueue', () => {
    const items: QueueItem[] = [
      makeItem({ state: 'active', title: 'Current work', id: queueItemId('Current work') }),
      makeItem({
        state: 'next',
        title: 'Plan phase 2',
        id: queueItemId('Plan phase 2'),
        signals: [{ type: 'due', value: '2026-07-28' }],
      }),
    ];
    const md = serializeQueue(items);
    const parsed = parseQueue(md);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].state).toBe('active');
    expect(parsed[1].signals[0]).toEqual({ type: 'due', value: '2026-07-28' });
  });
});

// ─── prioritizeNext ───────────────────────────────────────────────────────────

describe('prioritizeNext', () => {
  const TODAY = '2026-07-24';

  it('puts overdue items first', () => {
    const items: QueueItem[] = [
      makeItem({ id: 'a', state: 'next', signals: [{ type: 'due', value: '2026-07-30' }] }),
      makeItem({ id: 'b', state: 'next', signals: [{ type: 'due', value: '2026-07-20' }] }),
    ];
    const sorted = prioritizeNext(items, TODAY);
    expect(sorted[0].id).toBe('b');
  });

  it('sinks blocked items to bottom', () => {
    const items: QueueItem[] = [
      makeItem({ id: 'blocked', state: 'next', signals: [{ type: 'blocked', value: 'waiting' }] }),
      makeItem({ id: 'unblocked', state: 'next', signals: [] }),
    ];
    const sorted = prioritizeNext(items, TODAY);
    expect(sorted[0].id).toBe('unblocked');
    expect(sorted[1].id).toBe('blocked');
  });

  it('ignores non-next items', () => {
    const items: QueueItem[] = [
      makeItem({ id: 'active', state: 'active' }),
      makeItem({ id: 'next', state: 'next' }),
    ];
    const sorted = prioritizeNext(items, TODAY);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].id).toBe('next');
  });
});

// ─── formatQueueSummary ───────────────────────────────────────────────────────

describe('formatQueueSummary', () => {
  const TODAY = '2026-07-24';

  it('returns "Queue is empty." for an empty list', () => {
    expect(formatQueueSummary([], TODAY)).toBe('Queue is empty.');
  });

  it('shows active items', () => {
    const items = [makeItem({ state: 'active', title: 'Big active task' })];
    const out = formatQueueSummary(items, TODAY);
    expect(out).toContain('Active:');
    expect(out).toContain('Big active task');
  });

  it('shows inbox count', () => {
    const items = [
      makeItem({ id: '1', state: 'inbox', title: 'A' }),
      makeItem({ id: '2', state: 'inbox', title: 'B' }),
    ];
    const out = formatQueueSummary(items, TODAY);
    expect(out).toContain('Inbox: 2 unsorted items');
  });

  it('caps next-up display at topN', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      makeItem({ id: String(i), title: `Task ${i}`, state: 'next' }),
    );
    const out = formatQueueSummary(items, TODAY, 3);
    expect(out).toContain('… and 5 more');
  });
});
