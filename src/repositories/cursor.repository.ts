import { createReadStream } from 'fs';
import { readdir, readFile, stat } from 'fs/promises';
import { createInterface } from 'readline';
import { injectable } from 'inversify';
import { Activity, ChronicleWindow, NEEDS_REVIEW_MARKER } from '../types';

/**
 * Source adapter for Cursor Agent / CLI conversation activity. Resource access
 * only — no business logic.
 *
 * Cursor persists one transcript per session under
 * ~/.cursor/projects/<cwd-slug>/agent-transcripts/<session-id>/<session-id>.jsonl.
 * The cwd-slug is the absolute path with slashes replaced by hyphens and the
 * leading slash dropped (e.g. /Users/foo/proj → Users-foo-proj), so project
 * directories are resolved by slug prefix match against projectPath — this
 * captures workspace-root sessions that span multiple repos.
 *
 * Unlike Claude Code JSONL, Cursor transcript records carry no timestamps and
 * no distilled title. Session metadata lives separately under
 * ~/.cursor/chats/<md5-of-cwd>/<session-id>/meta.json with `title`,
 * `createdAtMs`, `updatedAtMs`, and `cwd` — but only for sessions Cursor has
 * summarized. Per-session extraction therefore works in two layers:
 *
 *   summary   — meta.json `title` when present; falls back to the first user
 *               prompt (unwrapped from Cursor's injected <user_query> envelope)
 *               truncated to 120 chars and flagged [needs-review].
 *   timestamp — meta.json `createdAtMs`; falls back to the transcript file's
 *               birthtime. A session belongs to the window its creation time
 *               falls in (multi-day sessions are attributed to their start day).
 *   evidence  — sessionId ref.
 *
 * Sessions with neither a title nor any user prompt text are dropped.
 */
export interface ICursorRepository {
  getActivity(
    window: ChronicleWindow,
    projectPath?: string,
  ): Promise<Activity[]>;
  /**
   * Resolve the local calendar date (YYYY-MM-DD) a session is attributed to —
   * its creation day, from meta.json `createdAtMs` or the transcript file's
   * birthtime. Returns null when the session cannot be found. Used by
   * append-session to regenerate the day the session belongs to rather than
   * assuming today (a session's later turns can cross midnight).
   */
  findSessionDate(sessionId: string): Promise<string | null>;
}

/** Max chars for a fallback prompt title. */
const FALLBACK_TITLE_MAX = 120;

/** ~/.cursor/projects/ base — evaluated at call time so tests can override HOME. */
const projectsBase = () => `${process.env.HOME}/.cursor/projects`;

/** ~/.cursor/chats/ base — where per-session meta.json lives. */
const chatsBase = () => `${process.env.HOME}/.cursor/chats`;

/** Format a Date as its local calendar date, YYYY-MM-DD. */
const toLocalDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

/** Shape of the fields Chronicle reads from a Cursor session meta.json. */
interface CursorSessionMeta {
  title?: string;
  createdAtMs?: number;
}

/**
 * System-injected envelope tags Cursor wraps around the raw user prompt.
 * Stripped when deriving a fallback title from the first user message.
 */
const INJECTED_TAG_RE =
  /<(external_links|attached_files|user_info|system_reminder|system_notification|timestamp|rules|agent_transcripts|agent_skills)>[\s\S]*?<\/\1>/g;

/**
 * Transcript-reading implementation of {@link ICursorRepository}.
 *
 * Resolves per-project transcript directories under `~/.cursor/projects/` by
 * cwd-slug prefix match, then enriches each session from its meta.json (title +
 * creation time) with transcript/file-time fallbacks — see the interface doc
 * for the extraction rules. Malformed lines, missing metadata, and unreadable
 * files are skipped rather than thrown, so a corrupt session never fails the
 * Chronicle. Results are sorted by timestamp ascending.
 */
@injectable()
export class CursorRepository implements ICursorRepository {
  /** @inheritDoc */
  async getActivity(
    window: ChronicleWindow,
    projectPath?: string,
  ): Promise<Activity[]> {
    const transcriptDirs = await this._resolveTranscriptDirs(projectPath);
    if (transcriptDirs.length === 0) return [];

    // Hash dirs under ~/.cursor/chats/ are md5(cwd); enumerate once per run so
    // meta.json lookup by session id is a cheap existence probe per hash.
    const chatHashDirs = await this._listChatHashDirs();

    const results: Activity[] = [];
    for (const dir of transcriptDirs) {
      const sessions = await this._extractSessions(dir, window, chatHashDirs);
      results.push(...sessions);
    }

    return results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /** @inheritDoc */
  async findSessionDate(sessionId: string): Promise<string | null> {
    const meta = await this._readMeta(
      sessionId,
      await this._listChatHashDirs(),
    );
    if (meta?.createdAtMs && Number.isFinite(meta.createdAtMs)) {
      return toLocalDate(new Date(meta.createdAtMs));
    }

    // No meta yet — locate the transcript across all project dirs and use its
    // birthtime, mirroring the getActivity timestamp fallback.
    let entries: string[];
    try {
      entries = await readdir(projectsBase());
    } catch {
      return null;
    }
    for (const entry of entries) {
      const path = `${projectsBase()}/${entry}/agent-transcripts/${sessionId}/${sessionId}.jsonl`;
      try {
        const s = await stat(path);
        const birth = s.birthtime.getTime() > 0 ? s.birthtime : s.mtime;
        return toLocalDate(birth);
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Map projectPath (an absolute filesystem path) to matching
   * `agent-transcripts` directories under ~/.cursor/projects/ by cwd-slug
   * prefix match.
   *
   * Cursor converts a cwd like /Users/foo/projects/rosetta to the slug
   * Users-foo-projects-rosetta (no leading hyphen, unlike Claude Code).
   */
  private async _resolveTranscriptDirs(
    projectPath?: string,
  ): Promise<string[]> {
    const base = projectsBase();
    let entries: string[];
    try {
      entries = await readdir(base);
    } catch {
      return [];
    }

    const targetSlug = projectPath
      ? projectPath.replace(/\//g, '-').replace(/^-/, '')
      : null;

    return entries
      .filter((entry) => (targetSlug ? entry.startsWith(targetSlug) : true))
      .map((entry) => `${base}/${entry}/agent-transcripts`);
  }

  /** Enumerate the md5(cwd) hash directories under ~/.cursor/chats/. */
  private async _listChatHashDirs(): Promise<string[]> {
    try {
      const entries = await readdir(chatsBase());
      return entries.map((e) => `${chatsBase()}/${e}`);
    } catch {
      return [];
    }
  }

  /** Extract one Activity per session directory in an agent-transcripts dir. */
  private async _extractSessions(
    dir: string,
    window: ChronicleWindow,
    chatHashDirs: string[],
  ): Promise<Activity[]> {
    let sessionIds: string[];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      sessionIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }

    const activities: Activity[] = [];
    for (const sessionId of sessionIds) {
      const activity = await this._parseSession(
        `${dir}/${sessionId}/${sessionId}.jsonl`,
        sessionId,
        window,
        chatHashDirs,
      );
      if (activity) activities.push(activity);
    }
    return activities;
  }

  /** Build the Activity for one session, or null if out-of-window/empty. */
  private async _parseSession(
    filePath: string,
    sessionId: string,
    window: ChronicleWindow,
    chatHashDirs: string[],
  ): Promise<Activity | null> {
    const meta = await this._readMeta(sessionId, chatHashDirs);

    const timestamp = await this._resolveTimestamp(filePath, meta);
    if (!timestamp) return null;

    // Use local-time boundaries so sessions after ~7 PM in negative-UTC-offset
    // timezones are not pushed into the next calendar day.
    const windowStart = new Date(`${window.start}T00:00:00`).toISOString();
    const windowEnd = new Date(`${window.end}T23:59:59.999`).toISOString();
    if (timestamp < windowStart || timestamp > windowEnd) return null;

    const title =
      meta?.title && meta.title.trim().length > 0
        ? meta.title.trim()
        : undefined;
    const fallbackPrompt = title
      ? undefined
      : await this._firstUserPrompt(filePath);

    const needsReview = title === undefined;
    const summary = title
      ? title
      : fallbackPrompt
        ? `${fallbackPrompt} ${NEEDS_REVIEW_MARKER}`
        : null;

    // Drop sessions with neither a title nor any prompt text.
    if (!summary) return null;

    return {
      source: 'cursor',
      id: sessionId,
      timestamp,
      summary,
      evidence: [
        {
          source: 'cursor' as const,
          ref: sessionId,
          description: `Cursor session ${sessionId.slice(0, 8)}`,
        },
      ],
      ...(needsReview ? { reviewNeeded: true } : {}),
    };
  }

  /** Locate and parse the session's meta.json across the chat hash dirs. */
  private async _readMeta(
    sessionId: string,
    chatHashDirs: string[],
  ): Promise<CursorSessionMeta | null> {
    for (const hashDir of chatHashDirs) {
      try {
        const raw = await readFile(
          `${hashDir}/${sessionId}/meta.json`,
          'utf-8',
        );
        return JSON.parse(raw) as CursorSessionMeta;
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Session anchor time: meta createdAtMs, else the transcript's birthtime
   * (mtime would drift to the last message, misattributing multi-day sessions).
   */
  private async _resolveTimestamp(
    filePath: string,
    meta: CursorSessionMeta | null,
  ): Promise<string | null> {
    if (meta?.createdAtMs && Number.isFinite(meta.createdAtMs)) {
      return new Date(meta.createdAtMs).toISOString();
    }
    try {
      const s = await stat(filePath);
      const birth = s.birthtime.getTime() > 0 ? s.birthtime : s.mtime;
      return birth.toISOString();
    } catch {
      return null;
    }
  }

  /**
   * Stream the transcript for the first non-empty user prompt, unwrapping
   * Cursor's injected envelope: prefer the <user_query> body when present,
   * otherwise strip known system-injected tag blocks.
   */
  private async _firstUserPrompt(
    filePath: string,
  ): Promise<string | undefined> {
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

        if (record['role'] !== 'user') continue;
        const text = this._extractText(record['message']);
        if (!text) continue;

        const cleaned = this._cleanPrompt(text);
        if (cleaned.length > 0) {
          rl.close();
          return cleaned.slice(0, FALLBACK_TITLE_MAX);
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  /** Pull the first text chunk out of a Cursor message payload. */
  private _extractText(message: unknown): string | undefined {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return undefined;
    }
    const content = (message as Record<string, unknown>)['content'];
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return undefined;
    for (const chunk of content) {
      if (
        chunk &&
        typeof chunk === 'object' &&
        (chunk as Record<string, unknown>)['type'] === 'text'
      ) {
        const text = (chunk as Record<string, unknown>)['text'];
        if (typeof text === 'string' && text.trim().length > 0) return text;
      }
    }
    return undefined;
  }

  /** Unwrap <user_query> or strip injected tag blocks, then normalize whitespace. */
  private _cleanPrompt(text: string): string {
    const queryMatch = /<user_query>([\s\S]*?)<\/user_query>/.exec(text);
    const body = queryMatch ? queryMatch[1] : text.replace(INJECTED_TAG_RE, '');
    return body.replace(/\s+/g, ' ').trim();
  }
}
