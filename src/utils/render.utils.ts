import {
  Activity,
  ChronicleSection,
  ChronicleWindow,
  NEEDS_REVIEW_MARKER,
  Tag,
} from '../types';

/**
 * Pure Markdown rendering helpers for the Daily Chronicle. No I/O, no DI.
 */

/** e.g. (1, 'commit') -> '1 commit'; (0, 'note') -> '0 notes'. */
export const pluralize = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Render a git-commit Activity as a Markdown list item with its short SHA. */
export const renderCommitLine = (a: Activity): string =>
  `- ${a.summary} _(${a.evidence[0]?.ref.slice(0, 8) ?? 'unknown'})_`;

/**
 * Render commit activity grouped by originating repository, each under a
 * `**repo**` subheading in repo-name order. Commits without a `repo` attribution
 * are grouped last under "other". Used when a Chronicle spans multiple repos.
 */
export const renderCommitsByRepo = (commits: Activity[]): string => {
  const groups = new Map<string, Activity[]>();
  for (const c of commits) {
    const key = c.repo ?? 'other';
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  return [...groups.keys()]
    .sort()
    .map((repo) => {
      const lines = groups
        .get(repo)!
        .map(renderCommitLine)
        .join('\n');
      return `**${repo}**\n${lines}`;
    })
    .join('\n\n');
};

/** Render a manual-note Activity as a Markdown list item. */
export const renderNoteLine = (a: Activity): string => `- ${a.summary}`;

/** Render a single Claude session Activity as a Markdown list item. */
export const renderSessionLine = (a: Activity, stripMarker = false): string => {
  const summary = stripMarker
    ? a.summary.replace(NEEDS_REVIEW_MARKER, '').trim()
    : a.summary;
  const prLinks = a.evidence
    .filter((e) => e.ref.includes('#') && e.url)
    .map((e) => `[${e.ref}](${e.url})`)
    .join(', ');
  return prLinks ? `- ${summary} _(${prLinks})_` : `- ${summary}`;
};

const formatWindow = (window: ChronicleWindow): string =>
  window.start === window.end
    ? window.start
    : `${window.start} → ${window.end}`;

/** Render the full Daily Chronicle Markdown document from its parts. */
export const renderDailyChronicle = (
  window: ChronicleWindow,
  sections: ChronicleSection[],
  tags: Tag[],
): string => {
  const lines: string[] = [];

  lines.push('# Daily Chronicle');
  lines.push('');
  lines.push(`_${formatWindow(window)}_`);
  lines.push('');

  for (const section of sections) {
    lines.push(`## ${section.heading}`);
    lines.push('');
    lines.push(section.body.trim().length > 0 ? section.body.trim() : '_No activity recorded._');
    lines.push('');
  }

  lines.push('## Suggested Tags');
  lines.push('');
  lines.push(tags.length > 0 ? tags.map((t) => `\`[${t}]\``).join(' ') : '_None inferred._');
  lines.push('');

  return lines.join('\n');
};
