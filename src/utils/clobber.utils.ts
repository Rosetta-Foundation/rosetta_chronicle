import { Activity } from '../types';

/**
 * Pure helper for detecting a regeneration that would clobber prior activity.
 * No I/O, no DI. See PRD-0005.
 *
 * Derived activity (git commits, agent sessions) is rebuilt from whatever
 * sources a run can currently see. A run that sees fewer sources than a prior
 * run — a narrow `--project` scope, a stale local checkout, an unreachable
 * transcript store — regenerates the day with less activity and would overwrite
 * the richer prior Chronicle. This compares the two activity-id sets to catch
 * that before the destructive write.
 */

/** The result of comparing freshly-generated activity against prior activity. */
export interface ClobberCheck {
  /** Activity present in the prior sidecar but absent from the fresh run. */
  dropped: Activity[];
  /**
   * True when persisting would lose activity with nothing new to offset it —
   * i.e. the fresh set is a strict subset of the prior set. A run that adds
   * anything new (or only re-adds the same set) never trips this.
   */
  wouldClobber: boolean;
}

/**
 * Compare freshly-generated activity against the prior run's activity (from the
 * structured sidecar). `wouldClobber` is true only when the fresh set drops at
 * least one prior activity AND introduces nothing new — a pure regression. When
 * there is no prior activity, nothing can be clobbered.
 */
export const checkClobber = (
  fresh: Activity[],
  prior: Activity[],
): ClobberCheck => {
  const freshIds = new Set(fresh.map((a) => a.id));
  const priorById = new Map(prior.map((a) => [a.id, a]));

  const dropped: Activity[] = [];
  for (const [id, activity] of priorById) {
    if (!freshIds.has(id)) dropped.push(activity);
  }

  // Anything in fresh that the prior run didn't have offsets the shrink.
  const addedSomething = fresh.some((a) => !priorById.has(a.id));

  return { dropped, wouldClobber: dropped.length > 0 && !addedSomething };
};

/** One-line human-readable description of a dropped activity, for the report. */
export const describeDropped = (a: Activity): string => {
  const where = a.repo ? ` [${a.repo}]` : '';
  return `- (${a.source}${where}) ${a.summary}`;
};
