import path from 'path';
import { injectable, inject } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import {
  Activity,
  ChronicleSection,
  DailyChronicle,
  DailyChronicleInput,
  Evidence,
} from '../types';
import { inferTags, ALL_TAGS } from '../utils/tags.utils';
import { isChronicleLedgerCommit } from '../utils/commit.utils';
import {
  renderDailyChronicle,
  renderCommitLine,
  renderCommitsByRepo,
  renderNoteLine,
  renderSessionLine,
  pluralize,
} from '../utils/render.utils';
import { parseExistingTags } from '../utils/chronicle-parse.utils';
import type { IGitRepository } from '../repositories/git.repository';
import type { IGitDiscoveryRepository } from '../repositories/git-discovery.repository';
import type { IClaudeCodeRepository } from '../repositories/claude-code.repository';
import type { ICursorRepository } from '../repositories/cursor.repository';
import type { INotesRepository } from '../repositories/notes.repository';
import type { ICalendarRepository } from '../repositories/calendar.repository';

/**
 * The synthesis engine. Gathers activity from every source repository,
 * correlates evidence, infers tags, and composes the Daily Chronicle document.
 *
 * Business/orchestration logic lives here. Services compose repositories; they
 * never call other services.
 */
export interface IChronicleService {
  generateDailyChronicle(input: DailyChronicleInput): Promise<DailyChronicle>;
}

/**
 * Orchestration implementation of {@link IChronicleService}.
 *
 * Composes the source repositories to build a Daily Chronicle: resolves and
 * aggregates git activity across one or many repositories (via
 * {@link IGitDiscoveryRepository} + {@link IGitRepository}), gathers agent
 * session (Claude Code + Cursor) and note activity in parallel, merges tags and
 * notes carried over from
 * any prior Chronicle, infers taxonomy tags, composes the document sections, and
 * renders Markdown. All cross-repository composition lives here — per the HSR
 * rules this service depends only on repositories and never calls another
 * service. It holds no resource access itself.
 */
@injectable()
export class ChronicleService implements IChronicleService {
  constructor(
    @inject(CHRONICLE_TOKENS.GitRepository)
    private readonly _gitRepo: IGitRepository,
    @inject(CHRONICLE_TOKENS.GitDiscoveryRepository)
    private readonly _gitDiscoveryRepo: IGitDiscoveryRepository,
    @inject(CHRONICLE_TOKENS.ClaudeCodeRepository)
    private readonly _claudeCodeRepo: IClaudeCodeRepository,
    @inject(CHRONICLE_TOKENS.CursorRepository)
    private readonly _cursorRepo: ICursorRepository,
    @inject(CHRONICLE_TOKENS.NotesRepository)
    private readonly _notesRepo: INotesRepository,
    @inject(CHRONICLE_TOKENS.CalendarRepository)
    private readonly _calendarRepo: ICalendarRepository,
  ) {}

  /** @inheritDoc */
  async generateDailyChronicle(
    input: DailyChronicleInput,
  ): Promise<DailyChronicle> {
    // Prior tags come from the structured sidecar (source of truth), passed in
    // as `priorTags` by the handler. Fall back to scraping the rendered Markdown
    // only for legacy days that predate the sidecar (one-time migration).
    // Notes are never re-parsed from Markdown — they arrive via `input.notes`,
    // resolved from the authoritative notes file (PRD-0003).
    const priorTags =
      input.priorTags ??
      (input.existingMarkdown ? parseExistingTags(input.existingMarkdown) : []);

    const [
      gitActivity,
      claudeActivity,
      cursorActivity,
      typedNotes,
      calendarActivity,
    ] = await Promise.all([
      this._collectGitActivity(input),
      input.claudeCodeProjectPath
        ? this._claudeCodeRepo.getActivity(
            input.window,
            input.claudeCodeProjectPath,
          )
        : Promise.resolve([] as Activity[]),
      input.cursorProjectPath
        ? this._cursorRepo.getActivity(input.window, input.cursorProjectPath)
        : Promise.resolve([] as Activity[]),
      this._notesRepo.getActivity(input.window, input.notes),
      this._calendarRepo.getActivity(input.window, input.calendarIcsPath),
    ]);

    // Claude Code and Cursor sessions are the same kind of activity — one
    // agent-sessions stream, ordered by time regardless of tool.
    const sessionActivity = [...claudeActivity, ...cursorActivity].sort(
      (a, b) => a.timestamp.localeCompare(b.timestamp),
    );

    // Calendar meetings are discussion-type activity: fold them into the notes
    // section (deduped by id — a hand-typed note and its calendar entry keep
    // distinct ids, so both surface), ordered by time.
    const noteActivity = [...typedNotes, ...calendarActivity].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );

    const activities = [
      ...gitActivity,
      ...sessionActivity,
      ...noteActivity,
    ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // Union freshly inferred tags with any tags carried over from a prior run,
    // preserving taxonomy order.
    const freshTags = inferTags(activities);
    const tagSet = new Set([...freshTags, ...priorTags]);
    const tags = ALL_TAGS.filter((t) => tagSet.has(t));

    const sections = this._composeSections(
      gitActivity,
      sessionActivity,
      noteActivity,
    );
    const markdown = renderDailyChronicle(input.window, sections, tags);

    return {
      window: input.window,
      sections,
      tags,
      markdown,
      data: { window: input.window, tags, activities },
    };
  }

  /**
   * Resolve the set of git repositories in scope, then aggregate their in-window
   * commit activity. When `workspaceRoot` is set, every repository discovered
   * under it is included (unioned with an explicit `gitRepoPath`); otherwise
   * only `gitRepoPath` is queried.
   *
   * Self-exclusion is protocol, not path-matching (ADR-0007): commits whose
   * subject carries the `chronicle:` type (or the legacy
   * `chore: daily chronicle` subject) are machine-authored ledger writes and
   * are never ingested, wherever they live. Skipping the Chronicle output repo
   * during discovery remains as an optimization. Orchestration lives here —
   * discovery and per-repo querying are separate repositories.
   */
  private async _collectGitActivity(
    input: DailyChronicleInput,
  ): Promise<Activity[]> {
    const includeMerges = input.discovery?.includeMerges ?? false;

    const repoPaths = new Set<string>();
    if (input.gitRepoPath) repoPaths.add(input.gitRepoPath);
    if (input.workspaceRoot) {
      const discovered = await this._gitDiscoveryRepo.discover(
        input.workspaceRoot,
        input.discovery,
      );
      for (const p of discovered) repoPaths.add(p);
    }

    // Skip the Chronicle output repo during discovery — an optimization on top
    // of the message-based rule below. An explicit gitRepoPath is honored (the
    // caller asked for it); only discovered repos are filtered.
    const outputRepo = input.outputRepoPath
      ? path.resolve(input.outputRepoPath)
      : null;
    const scoped = [...repoPaths].filter(
      (p) =>
        !outputRepo ||
        p === input.gitRepoPath ||
        path.resolve(p) !== outputRepo,
    );

    const perRepo = await Promise.all(
      scoped.map((repoPath) =>
        this._gitRepo.getActivity(repoPath, input.window, includeMerges),
      ),
    );

    // The self-exclusion invariant (ADR-0007): machine-authored ledger commits
    // are Chronicle writing to itself, never engineering work — drop them by
    // commit type, regardless of which repository they were found in.
    return perRepo
      .flat()
      .filter((a) => !isChronicleLedgerCommit(a.summary))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /** Compose sections from the collected activities, by source. */
  private _composeSections(
    gitActivity: Activity[],
    sessionActivity: Activity[],
    noteActivity: Activity[],
  ): ChronicleSection[] {
    const total =
      gitActivity.length + sessionActivity.length + noteActivity.length;
    const allEvidence: Evidence[] = [
      ...gitActivity,
      ...sessionActivity,
      ...noteActivity,
    ].flatMap((a) => a.evidence);

    const claudeCount = sessionActivity.filter(
      (a) => a.source === 'claude-code',
    ).length;
    const cursorCount = sessionActivity.filter(
      (a) => a.source === 'cursor',
    ).length;

    const parts: string[] = [];
    if (gitActivity.length > 0)
      parts.push(pluralize(gitActivity.length, 'commit'));
    if (claudeCount > 0) parts.push(pluralize(claudeCount, 'Claude session'));
    if (cursorCount > 0) parts.push(pluralize(cursorCount, 'Cursor session'));
    if (noteActivity.length > 0)
      parts.push(pluralize(noteActivity.length, 'note'));

    const summary =
      total === 0
        ? 'No engineering activity was recorded for this window.'
        : `${parts.join(', ')} recorded across the day.`;

    const sections: ChronicleSection[] = [
      { heading: 'Executive Summary', body: summary, evidence: allEvidence },
    ];

    if (gitActivity.length > 0) {
      // Group by repo when the day's commits span more than one repository;
      // otherwise keep the flat list.
      const repoCount = new Set(gitActivity.map((a) => a.repo ?? 'other')).size;
      const body =
        repoCount > 1
          ? renderCommitsByRepo(gitActivity)
          : gitActivity.map(renderCommitLine).join('\n');
      sections.push({
        heading: 'Work Completed',
        body,
        evidence: gitActivity.flatMap((a) => a.evidence),
      });
    }

    if (sessionActivity.length > 0) {
      const confirmed = sessionActivity.filter((a) => !a.reviewNeeded);
      const needsReview = sessionActivity.filter((a) => a.reviewNeeded);

      let body = confirmed.map((a) => renderSessionLine(a)).join('\n');
      if (needsReview.length > 0) {
        if (body.length > 0) body += '\n\n';
        body +=
          `**Sessions to review** _(untitled — accept, retitle, or discard)_\n` +
          needsReview
            .map((a) => renderSessionLine(a, /* stripMarker */ true))
            .join('\n');
      }

      sections.push({
        heading: 'Agent Sessions',
        body,
        evidence: sessionActivity.flatMap((a) => a.evidence),
      });
    }

    if (noteActivity.length > 0) {
      sections.push({
        heading: 'Notes & Discussions',
        body: noteActivity.map(renderNoteLine).join('\n'),
        evidence: noteActivity.flatMap((a) => a.evidence),
      });
    }

    return sections;
  }
}
