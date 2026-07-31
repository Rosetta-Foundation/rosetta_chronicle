import { createHash } from 'crypto';
import { QueueItem, QueueRef, QueueSignal, QueueState } from '../types';

/**
 * Pure helpers for the personal work queue (PRD-0007 Phase 1).
 *
 * Parses the human-readable `queue.md` format (tagged checkbox lines organized
 * under section headings) into structured {@link QueueItem} objects, and
 * serializes them back to the same format so hand-edits and programmatic writes
 * stay interoperable.
 *
 * Format (one item per line):
 *   - [ ] Title of the work [jira:PROJ-72] [prd:0007/1] [due:2026-07-28]
 *   - [x] Done item [follow-up] → 2026-07-24
 *
 * Section headings determine state:
 *   ## Active   → 'active'
 *   ## Next Up  → 'next'
 *   ## Inbox    → 'inbox'
 *   ## Done     → 'done'
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const SECTION_MAP: Record<string, QueueState> = {
  active: 'active',
  'next up': 'next',
  inbox: 'inbox',
  done: 'done',
};

const STATE_HEADING: Record<QueueState, string> = {
  active: 'Active',
  next: 'Next Up',
  inbox: 'Inbox',
  done: 'Done',
};

/** All sections in display order. */
const SECTION_ORDER: QueueState[] = ['active', 'next', 'inbox', 'done'];

// ─── Tag parsing ──────────────────────────────────────────────────────────────

const TAG_RE = /\[([a-z-]+):([^\]]+)\]/gi;
const DUE_CLOSE_RE = /→\s*(\d{4}-\d{2}-\d{2})/;

/**
 * Extract structured refs and signals from the inline tag string of an item line.
 * Tags take the form `[type:value]` anywhere in the line.
 */
export const parseTags = (
  line: string,
): { refs: QueueRef[]; signals: QueueSignal[] } => {
  const refs: QueueRef[] = [];
  const signals: QueueSignal[] = [];
  let match: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(line)) !== null) {
    const [, rawType, value] = match;
    const type = rawType.toLowerCase();
    switch (type) {
      case 'jira':
      case 'prd':
      case 'pr':
      case 'follow-up':
      case 'idea':
      case 'slack':
        refs.push({ type: type as QueueRef['type'], key: value.trim() });
        break;
      case 'due':
        signals.push({ type: 'due', value: value.trim() });
        break;
      case 'blocked':
        signals.push({ type: 'blocked', value: value.trim() });
        break;
      case 'momentum':
        signals.push({ type: 'momentum', value: value.trim() });
        break;
      case 'dep':
      case 'dependency':
        signals.push({ type: 'dependency', value: value.trim() });
        break;
    }
  }
  return { refs, signals };
};

/**
 * Extract the human-readable title from an item line, stripping the checkbox
 * prefix (`- [ ] ` / `- [x] `), all inline tags, and the done-arrow suffix.
 */
export const parseTitle = (line: string): string =>
  line
    .replace(/^-\s*\[[x ]\]\s*/i, '')
    .replace(TAG_RE, '')
    .replace(DUE_CLOSE_RE, '')
    .trim();

/** Stable 12-char content-hash id for a title string. */
export const queueItemId = (title: string): string =>
  createHash('sha1').update(title.toLowerCase().trim()).digest('hex').slice(0, 12);

// ─── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parse a `queue.md` file body into {@link QueueItem} objects.
 * Lines that are not checkbox items (headings, comments, blank lines) are
 * ignored. Section headings (`## Active`, `## Next Up`, etc.) determine state.
 */
export const parseQueue = (markdown: string): QueueItem[] => {
  const items: QueueItem[] = [];
  let currentState: QueueState = 'inbox';

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();

    // Section heading
    if (trimmed.startsWith('##')) {
      const heading = trimmed.replace(/^#+\s*/, '').toLowerCase();
      currentState = SECTION_MAP[heading] ?? 'inbox';
      continue;
    }

    // Checkbox item: `- [ ] ...` or `- [x] ...`
    const checkboxMatch = /^-\s*\[([x ])\]\s+(.+)$/i.exec(trimmed);
    if (!checkboxMatch) continue;

    const [, checked, rest] = checkboxMatch;
    const done = checked.toLowerCase() === 'x';
    const state: QueueState = done ? 'done' : currentState;

    const title = parseTitle(`- [${checked}] ${rest}`);
    if (!title) continue;

    const { refs, signals } = parseTags(rest);

    // Extract close date from done-arrow
    const closeMatch = DUE_CLOSE_RE.exec(rest);
    const closedAt = closeMatch ? `${closeMatch[1]}T00:00:00` : undefined;

    // Use the first ref's key as id when available (stable across edits),
    // otherwise derive from title.
    const stableKey = refs.find((r) => r.type === 'jira' || r.type === 'prd')?.key;
    const id = stableKey ? queueItemId(stableKey) : queueItemId(title);

    items.push({
      id,
      title,
      state,
      refs,
      signals,
      addedAt: closedAt ?? new Date(0).toISOString(),
      ...(closedAt ? { closedAt } : {}),
    });
  }

  return items;
};

// ─── Serialization ────────────────────────────────────────────────────────────

/** Render a single {@link QueueItem} as a `queue.md` checkbox line. */
export const renderItem = (item: QueueItem): string => {
  const check = item.state === 'done' ? 'x' : ' ';
  const tags = [
    ...item.refs.map((r) => `[${r.type}:${r.key}]`),
    ...item.signals
      .filter((s) => s.type !== 'momentum')
      .map((s) => `[${s.type}:${s.value}]`),
  ].join(' ');
  const suffix =
    item.state === 'done' && item.closedAt
      ? ` → ${item.closedAt.slice(0, 10)}`
      : '';
  return `- [${check}] ${item.title}${tags ? ' ' + tags : ''}${suffix}`;
};

/**
 * Serialize a list of {@link QueueItem} objects to `queue.md` Markdown.
 * Items are grouped by state in display order (Active → Next Up → Inbox → Done).
 * The Done section is omitted when empty.
 */
export const serializeQueue = (items: QueueItem[]): string => {
  const byState = new Map<QueueState, QueueItem[]>();
  for (const s of SECTION_ORDER) byState.set(s, []);
  for (const item of items) {
    byState.get(item.state)!.push(item);
  }

  const sections: string[] = [
    '# Work Queue',
    '',
    '_Your personal "what\'s next?" list. Edit freely — tags make items machine-readable._',
    '_Tags: `[jira:KEY]` `[prd:NNNN/N]` `[due:YYYY-MM-DD]` `[blocked:reason]` `[follow-up]` `[idea]`_',
    '',
  ];

  for (const state of SECTION_ORDER) {
    const stateItems = byState.get(state)!;
    // Always render Active/Next Up/Inbox; skip Done when empty.
    if (state === 'done' && stateItems.length === 0) continue;

    sections.push(`## ${STATE_HEADING[state]}`);
    if (stateItems.length === 0) {
      sections.push('<!-- empty -->');
    } else {
      for (const item of stateItems) {
        sections.push(renderItem(item));
      }
    }
    sections.push('');
  }

  return sections.join('\n');
};

// ─── Priority ordering ────────────────────────────────────────────────────────

/**
 * Sort "Next Up" items by priority signals, returning them highest-priority first.
 * Order: overdue/due-soon first, then unblocked, then by insertion order.
 *
 * @param items  All queue items (not just Next Up — filter before displaying).
 * @param today  ISO date string (YYYY-MM-DD) representing "now".
 */
export const prioritizeNext = (items: QueueItem[], today: string): QueueItem[] => {
  const nextItems = items.filter((i) => i.state === 'next');

  return [...nextItems].sort((a, b) => {
    const dueA = a.signals.find((s) => s.type === 'due')?.value ?? '';
    const dueB = b.signals.find((s) => s.type === 'due')?.value ?? '';
    const blockedA = a.signals.some((s) => s.type === 'blocked');
    const blockedB = b.signals.some((s) => s.type === 'blocked');

    // Blocked items sink to the bottom.
    if (blockedA !== blockedB) return blockedA ? 1 : -1;

    // Due date: overdue / due today first, then ascending.
    if (dueA && dueB) return dueA.localeCompare(dueB);
    if (dueA && dueA <= today) return -1;
    if (dueB && dueB <= today) return 1;
    if (dueA) return -1;
    if (dueB) return 1;

    return 0;
  });
};

// ─── Display ─────────────────────────────────────────────────────────────────

/**
 * Format the queue as a concise terminal summary — active items, then the
 * top N next items, then inbox count.
 */
export const formatQueueSummary = (
  items: QueueItem[],
  today: string,
  topN = 5,
): string => {
  const active = items.filter((i) => i.state === 'active');
  const next = prioritizeNext(items, today);
  const inbox = items.filter((i) => i.state === 'inbox');

  const lines: string[] = [];

  if (active.length > 0) {
    lines.push('Active:');
    for (const item of active) lines.push(`  ▶ ${item.title}${_refSuffix(item)}`);
    lines.push('');
  }

  if (next.length > 0) {
    lines.push('Next up:');
    for (const item of next.slice(0, topN)) {
      const due = item.signals.find((s) => s.type === 'due');
      const dueStr = due ? `  [due ${due.value}]` : '';
      const blocked = item.signals.find((s) => s.type === 'blocked');
      const blockStr = blocked ? `  [blocked: ${blocked.value}]` : '';
      lines.push(`  ${item.title}${_refSuffix(item)}${dueStr}${blockStr}`);
    }
    if (next.length > topN) lines.push(`  … and ${next.length - topN} more`);
    lines.push('');
  }

  if (inbox.length > 0) {
    lines.push(`Inbox: ${inbox.length} unsorted item${inbox.length === 1 ? '' : 's'}`);
  }

  if (lines.length === 0) return 'Queue is empty.';
  return lines.join('\n').trimEnd();
};

const _refSuffix = (item: QueueItem): string => {
  const primary = item.refs.find((r) => r.type === 'jira' || r.type === 'prd');
  return primary ? `  [${primary.type}:${primary.key}]` : '';
};
