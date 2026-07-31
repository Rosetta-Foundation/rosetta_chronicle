import { createReadStream } from 'fs';
import { readdir } from 'fs/promises';
import { createInterface } from 'readline';
import { injectable } from 'inversify';
import { Activity, ChronicleWindow, NEEDS_REVIEW_MARKER } from '../types';

/**
 * Source adapter for Claude Code conversation activity. Resource access only —
 * no business logic.
 *
 * Reads Claude Code transcript JSONL files from the per-project directory under
 * ~/.claude/projects/<cwd-slug>/ and extracts one Activity per session. The
 * cwd-slug is the absolute path with slashes replaced by hyphens, so the
 * project directory is resolved by matching the projectPath prefix against the
 * slug rather than requiring an exact match — this handles workspace-root
 * sessions that span multiple repos.
 *
 * Per-session extraction:
 *   summary  — last ai-title record (most current post-compaction); falls back
 *              to the first user prompt truncated to 120 chars, flagged with
 *              [needs-review] so it surfaces in the review-needed subsection.
 *   timestamp — first user record in the window.
 *   evidence  — sessionId ref + deduplicated pr-link records.
 *
 * Sessions with no user records in the window (noise-only files) are dropped.
 */
export interface IClaudeCodeRepository {
  getActivity(window: ChronicleWindow, projectPath?: string): Promise<Activity[]>;
}

/** Max chars for a fallback prompt title. */
const FALLBACK_TITLE_MAX = 120;

/** ~/.claude/projects/ base — evaluated at call time so tests can override HOME. */
const projectsBase = () => `${process.env.HOME}/.claude/projects`;

/**
 * Transcript-reading implementation of {@link IClaudeCodeRepository}.
 *
 * Resolves the per-project transcript directories under `~/.claude/projects/` by
 * cwd-slug prefix match (so a workspace-root path captures cross-repo sessions),
 * then streams each session's JSONL line by line to extract a single
 * {@link Activity} — see the interface doc for the summary/timestamp/evidence
 * rules. Malformed lines and unreadable files are skipped rather than thrown, so
 * a corrupt transcript never fails the Chronicle. Results are sorted by
 * timestamp ascending.
 */
@injectable()
export class ClaudeCodeRepository implements IClaudeCodeRepository {
  /** @inheritDoc */
  async getActivity(
    window: ChronicleWindow,
    projectPath?: string,
  ): Promise<Activity[]> {
    const projectDirs = await this._resolveProjectDirs(projectPath);
    if (projectDirs.length === 0) return [];

    const results: Activity[] = [];
    for (const dir of projectDirs) {
      const sessions = await this._extractSessions(dir, window);
      results.push(...sessions);
    }

    return results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Map projectPath (an absolute filesystem path) to matching transcript
   * directories under ~/.claude/projects/ by cwd-slug prefix match.
   *
   * Claude Code converts a cwd like /Users/foo/projects/rosetta to the slug
   * -Users-foo-projects-rosetta. We match any slug whose reconstructed prefix
   * starts with the projectPath we're looking for.
   */
  private async _resolveProjectDirs(projectPath?: string): Promise<string[]> {
    const base = projectsBase();
    let entries: string[];
    try {
      entries = await readdir(base);
    } catch {
      return [];
    }

    if (!projectPath) return entries.map((e) => `${base}/${e}`);

    // Normalize: /Users/foo/projects/rosetta → -Users-foo-projects-rosetta
    const targetSlug = projectPath.replace(/\//g, '-');

    return entries
      .filter((entry) => entry.startsWith(targetSlug))
      .map((entry) => `${base}/${entry}`);
  }

  /** Extract one Activity per session file in a project directory. */
  private async _extractSessions(
    dir: string,
    window: ChronicleWindow,
  ): Promise<Activity[]> {
    let files: string[];
    try {
      const entries = await readdir(dir);
      files = entries.filter((e) => e.endsWith('.jsonl'));
    } catch {
      return [];
    }

    const activities: Activity[] = [];
    for (const file of files) {
      const sessionId = file.replace('.jsonl', '');
      const activity = await this._parseSession(
        `${dir}/${file}`,
        sessionId,
        window,
      );
      if (activity) activities.push(activity);
    }
    return activities;
  }

  /** Parse one JSONL session file into an Activity, or null if out-of-window. */
  private async _parseSession(
    filePath: string,
    sessionId: string,
    window: ChronicleWindow,
  ): Promise<Activity | null> {
    // Use local-time boundaries so sessions after ~7 PM in negative-UTC-offset
    // timezones are not pushed into the next calendar day.
    const windowStart = new Date(`${window.start}T00:00:00`).toISOString();
    const windowEnd = new Date(`${window.end}T23:59:59.999`).toISOString();

    let lastTitle: string | undefined;
    let firstTimestamp: string | undefined;
    let firstPrompt: string | undefined;
    const seenPrs = new Set<string>();
    const prEvidence: Array<{ ref: string; url: string; description: string }> =
      [];

    try {
      const rl = createInterface({
        input: createReadStream(filePath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;
        let record: Record<string, unknown>;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }

        const type = record['type'] as string | undefined;

        if (type === 'ai-title') {
          const t = record['aiTitle'];
          if (typeof t === 'string' && t.length > 0) lastTitle = t;
          continue;
        }

        if (type === 'pr-link') {
          const prRepo = record['prRepository'] as string | undefined;
          const prNum = record['prNumber'];
          const prUrl = record['prUrl'] as string | undefined;
          if (prRepo && prNum != null) {
            const key = `${prRepo}#${prNum}`;
            if (!seenPrs.has(key)) {
              seenPrs.add(key);
              prEvidence.push({
                ref: key,
                url: prUrl ?? '',
                description: `PR ${key}`,
              });
            }
          }
          continue;
        }

        if (type === 'user') {
          const ts = record['timestamp'] as string | undefined;
          if (!ts) continue;

          // Only count user records within the window for timestamp anchoring.
          if (ts < windowStart || ts > windowEnd) continue;

          if (firstTimestamp === undefined) {
            firstTimestamp = ts;

            // Extract first prompt text for fallback title.
            const msg = record['message'];
            if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
              const content = (msg as Record<string, unknown>)['content'];
              if (Array.isArray(content)) {
                for (const chunk of content) {
                  if (
                    chunk &&
                    typeof chunk === 'object' &&
                    (chunk as Record<string, unknown>)['type'] === 'text'
                  ) {
                    const text = (chunk as Record<string, unknown>)[
                      'text'
                    ] as string;
                    if (text?.trim().length > 0) {
                      firstPrompt = text.trim().slice(0, FALLBACK_TITLE_MAX);
                      break;
                    }
                  }
                }
              }
            }
          }
        }
      }
    } catch {
      return null;
    }

    // Drop sessions with no user activity in the window.
    if (firstTimestamp === undefined) return null;

    const needsReview = lastTitle === undefined;
    const summary = lastTitle
      ? lastTitle
      : firstPrompt
        ? `${firstPrompt} ${NEEDS_REVIEW_MARKER}`
        : null;

    // Drop sessions with neither a title nor any prompt text.
    if (!summary) return null;

    const evidence = [
      {
        source: 'claude-code' as const,
        ref: sessionId,
        description: `Claude Code session ${sessionId.slice(0, 8)}`,
      },
      ...prEvidence.map((pr) => ({
        source: 'claude-code' as const,
        ref: pr.ref,
        description: pr.description,
        url: pr.url || undefined,
      })),
    ];

    return {
      source: 'claude-code',
      id: sessionId,
      timestamp: firstTimestamp,
      summary,
      evidence,
      ...(needsReview ? { reviewNeeded: true } : {}),
    } as Activity & { reviewNeeded?: boolean };
  }
}
