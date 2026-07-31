import { Activity, Tag } from '../types';

/**
 * Pure helpers for inferring tags from activity. No I/O, no DI — pure functions
 * only. See docs/mvp.md for the tag taxonomy.
 */

/** All valid tags in the Rosetta taxonomy. */
export const ALL_TAGS: readonly Tag[] = [
  'DELIVERY',
  'RELIABILITY',
  'PERFORMANCE',
  'CROSS-TEAM',
  'ARCH',
  'OBSERVABILITY',
  'SECURITY',
  'DEV',
  'LEVERAGE',
];

/**
 * Keyword heuristics per tag. A tag applies when any of its patterns matches an
 * activity summary (case-insensitive). Deliberately conservative — v0.1 favors
 * precision; model-assisted inference comes later.
 */
const TAG_PATTERNS: Record<Tag, RegExp[]> = {
  DELIVERY: [/\bfeat\b/i, /\bfeature\b/i, /\bship\b/i, /\bdeliver/i, /\brelease\b/i],
  RELIABILITY: [/\bfix\b/i, /\bbug\b/i, /\bhotfix\b/i, /\brevert\b/i, /\bretry\b/i, /\bidempotent/i],
  PERFORMANCE: [/\bperf\b/i, /\bperformance\b/i, /\boptimi[sz]e/i, /\blatency\b/i, /\bcache\b/i],
  'CROSS-TEAM': [/\bcross-team\b/i, /\bdiscuss/i, /\bfederation\b/i, /\bpartner/i, /\bcollaborat/i],
  ARCH: [/\barch\b/i, /\barchitect/i, /\badr\b/i, /\bdesign\b/i, /\brefactor\b/i],
  OBSERVABILITY: [/\bobservab/i, /\blog(ging|s)?\b/i, /\bmetric/i, /\btrace/i, /\bmonitor/i, /\balert/i],
  SECURITY: [/\bsecurity\b/i, /\bauth\b/i, /\bokta\b/i, /\bentra\b/i, /\bsecret/i, /\bprivate\b/i, /\bpermission/i],
  DEV: [/\btest\b/i, /\bci\b/i, /\bbuild\b/i, /\bchore\b/i, /\bcoverage\b/i, /\btooling\b/i, /\bscaffold/i],
  LEVERAGE: [/\bautomat/i, /\btemplate/i, /\breusable\b/i, /\bworkflow\b/i, /\bprovision/i, /\bteam-setup\b/i],
};

/**
 * Infer the set of tags that apply to a collection of activities.
 *
 * Pure function — no I/O, no DI — so it is trivially unit-testable without the
 * container. Tags are returned in taxonomy order (see ALL_TAGS), deduplicated.
 */
export const inferTags = (activities: Activity[]): Tag[] => {
  const matched = new Set<Tag>();

  for (const activity of activities) {
    for (const tag of ALL_TAGS) {
      if (matched.has(tag)) continue;
      if (TAG_PATTERNS[tag].some((pattern) => pattern.test(activity.summary))) {
        matched.add(tag);
      }
    }
  }

  return ALL_TAGS.filter((tag) => matched.has(tag));
};
