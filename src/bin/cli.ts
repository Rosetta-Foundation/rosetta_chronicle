#!/usr/bin/env node
import 'reflect-metadata';
import {
  getDailyChronicleHandler,
  getChatGptInventoryHandler,
  getChatGptImportHandler,
  buildContainer,
} from '../index';
import { DailyChronicleInput, QueueItem, QueueState } from '../types';
import { describeDropped, ClobberCheck } from '../utils/clobber.utils';
import {
  formatQueueSummary,
  queueItemId,
  parseTags,
  prioritizeNext,
} from '../utils/queue.utils';
import { IQueueStore } from '../repositories/queue-store.repository';
import { ICursorRepository } from '../repositories/cursor.repository';
import { CHRONICLE_TOKENS } from '../tokens';

/**
 * Chronicle CLI — two commands:
 *
 *   chronicle backfill   Generate and persist Chronicles for a date range.
 *   chronicle append-session   Append a single agent session to today's Chronicle.
 *   chronicle inventory-chatgpt   Read-only ChatGPT export inventory (PRD-0027).
 *   chronicle import-chatgpt      Persist a stripped source graph (PRD-0027).
 *
 * Daily Chronicle commands write to the personal Chronicle repo
 * (CHRONICLE_REPO env var or --repo flag) and are idempotent by content hash.
 * import-chatgpt writes a source graph, not Activity or a Daily Chronicle.
 */

const USAGE = `
Usage:
  chronicle backfill [options]
  chronicle append-session [options]
  chronicle inventory-chatgpt --export <path>
  chronicle import-chatgpt --export <path> --repo <path> [--dry-run]
  chronicle queue [show] [--repo <path>]
  chronicle queue add "<title>" [--jira KEY] [--prd NNNN/N] [--due DATE] [--repo <path>]
  chronicle queue done "<title-or-id>" [--repo <path>]
  chronicle queue list [--state active|next|inbox|done] [--repo <path>]

Commands:
  backfill            Generate Daily Chronicles for a date range and persist them.
  append-session      Append a single agent session (Claude Code or Cursor) to
                      today's Chronicle.
                      Reads a JSON payload from stdin when --session-id is omitted
                      (Stop hook mode: {"session_id":"...", "cwd":"..."}).
  queue               Manage the personal work queue (PRD-0007).
    show              Print a summary of current queue items (default).
    add <title>       Add a new item to the Inbox.
    done <title|id>   Move an item to Done.
    list              List all items in a state.
  inventory-chatgpt   Read-only inventory of a ChatGPT export directory or
                      zip. Prints JSON. Does not write a Chronicle.
  import-chatgpt      Persist a stripped conversation graph into a personal
                      Chronicle repo. Idempotent by archive content hash.
                      Does not emit Activity or write a Daily Chronicle.

Options:
  --repo <path>       Absolute path to your personal Chronicle repo.
                      Falls back to $CHRONICLE_REPO environment variable.
  --project <path>    Absolute path of the project to scope agent sessions
                      (Claude Code + Cursor) to.
                      Falls back to $CHRONICLE_PROJECT or current working directory.
  --git-repo <path>   Git repo to include commits from. Defaults to --project.
  --calendar <path>   Path to an iCalendar (.ics) export to include the day's
                      meetings from. Falls back to $CHRONICLE_CALENDAR.
  --start <date>      Start date (YYYY-MM-DD). Required for backfill.
  --end <date>        End date (YYYY-MM-DD). Defaults to today.
  --dry-run           Print the generated Markdown without persisting.
  --force             Persist even if it would drop activity a prior run captured
                      (bypasses the clobber guard). Use for intentional shrinks.
  --session-id <id>   Session UUID to append (append-session only).
  --jira <KEY>        Attach a Jira key to a new queue item (e.g. PROJ-72).
  --prd <NNNN/N>      Attach a PRD phase reference (e.g. 0007/1).
  --due <YYYY-MM-DD>  Attach a due-date signal to a new queue item.
  --state <state>     Filter queue list by state (active|next|inbox|done).
  --export <path>     ChatGPT export directory or .zip
                      (inventory-chatgpt, import-chatgpt).
  -h, --help          Show this help.

Environment variables:
  CHRONICLE_REPO      Default value for --repo.
  CHRONICLE_PROJECT   Default value for --project.
  CHRONICLE_CALENDAR  Default value for --calendar (path to .ics export).
`.trim();

interface ParsedArgs {
  command: string;
  subcommand?: string;
  repo?: string;
  project?: string;
  gitRepo?: string;
  start?: string;
  end?: string;
  dryRun: boolean;
  sessionId?: string;
  force: boolean;
  calendar?: string;
  // queue-specific
  title?: string;
  jira?: string;
  prd?: string;
  due?: string;
  state?: QueueState;
  exportPath?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = { command: '', dryRun: false, force: false };

  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    console.log(USAGE);
    process.exit(0);
  }

  result.command = args[0];

  // For `queue`, the second positional is the subcommand (show|add|done|list).
  // A bare `chronicle queue` defaults to "show".
  if (result.command === 'queue') {
    const second = args[1];
    if (!second || second.startsWith('-')) {
      result.subcommand = 'show';
    } else if (['show', 'add', 'done', 'list'].includes(second)) {
      result.subcommand = second;
      // For add/done the title immediately follows the subcommand if it's not a flag.
      if (
        (second === 'add' || second === 'done') &&
        args[2] &&
        !args[2].startsWith('-')
      ) {
        result.title = args[2];
      }
    } else {
      // Bare string after `queue` without a subcommand keyword → treat as `show`
      result.subcommand = 'show';
    }
  }

  const startIdx = result.command === 'queue' && result.title ? 3 : 1;
  for (let i = startIdx; i < args.length; i++) {
    switch (args[i]) {
      case '--repo':
        result.repo = args[++i];
        break;
      case '--project':
        result.project = args[++i];
        break;
      case '--git-repo':
        result.gitRepo = args[++i];
        break;
      case '--start':
        result.start = args[++i];
        break;
      case '--end':
        result.end = args[++i];
        break;
      case '--session-id':
        result.sessionId = args[++i];
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--force':
        result.force = true;
        break;
      case '--calendar':
        result.calendar = args[++i];
        break;
      case '--jira':
        result.jira = args[++i];
        break;
      case '--prd':
        result.prd = args[++i];
        break;
      case '--due':
        result.due = args[++i];
        break;
      case '--state':
        result.state = args[++i] as QueueState;
        break;
      case '--export':
        result.exportPath = args[++i];
        break;
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
    }
  }

  return result;
}

function today(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Resolve the git scope for a run. An explicit `--git-repo` means single-repo
 * mode; otherwise the workspace root drives discovery of every repo underneath
 * it (mirroring how agent sessions are captured from the root).
 */
function gitScope(
  gitRepo: string | undefined,
  project: string,
): { gitRepoPath: string; workspaceRoot?: string } {
  return gitRepo
    ? { gitRepoPath: gitRepo }
    : { gitRepoPath: '', workspaceRoot: project };
}

function die(msg: string): never {
  console.error(`chronicle: ${msg}`);
  process.exit(1);
}

/** Report a clobber-guard block for one day: what would have been dropped. */
function reportClobber(date: string, clobber: ClobberCheck): void {
  console.error(
    `  ⚠ ${date} — SKIPPED: would drop ${clobber.dropped.length} activit${
      clobber.dropped.length === 1 ? 'y' : 'ies'
    } a prior run captured:`,
  );
  for (const a of clobber.dropped) {
    console.error(`      ${describeDropped(a)}`);
  }
}

async function runBackfill(args: ParsedArgs): Promise<void> {
  const repo = args.repo ?? process.env['CHRONICLE_REPO'];
  const project =
    args.project ?? process.env['CHRONICLE_PROJECT'] ?? process.cwd();
  const calendar = args.calendar ?? process.env['CHRONICLE_CALENDAR'];
  const start = args.start;
  const end = args.end ?? today();

  if (!start) die('--start <date> is required for backfill');
  if (!repo && !args.dryRun)
    die('--repo <path> (or $CHRONICLE_REPO) is required');

  // Enumerate every date in [start, end]
  const dates = enumerateDates(start, end);
  console.error(
    `chronicle backfill: ${dates.length} day(s) from ${start} to ${end}`,
  );

  const handler = getDailyChronicleHandler();
  let blocked = 0;

  for (const date of dates) {
    const input: DailyChronicleInput = {
      window: { start: date, end: date },
      // Explicit --git-repo → single repo; otherwise discover every repo under
      // the workspace root (mirrors how agent sessions are captured from root).
      ...gitScope(args.gitRepo, project),
      jiraTicketKeys: [],
      claudeCodeProjectPath: project,
      cursorProjectPath: project,
      force: args.force,
      // Range runs skip quiet days — never commit empty Chronicles for
      // weekends or vacations.
      skipEmpty: true,
      ...(calendar ? { calendarIcsPath: calendar } : {}),
      ...(repo && !args.dryRun ? { outputRepoPath: repo } : {}),
    };

    const result = await handler.handle(input);

    if (args.dryRun) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`# ${date}`);
      console.log(`${'─'.repeat(60)}`);
      console.log(result.chronicle.markdown);
    } else if (result.clobberPrevented) {
      blocked++;
      reportClobber(date, result.clobberPrevented);
    } else if (result.skippedEmpty) {
      console.error(`  · ${date} (no activity — skipped)`);
    } else {
      const p = result.persisted;
      if (p?.committed) {
        console.error(`  ✓ ${date} → ${p.path} (committed)`);
      } else if (p) {
        console.error(
          `  ~ ${date} → ${p.path} (written, not committed — already up to date?)`,
        );
      } else {
        console.error(`  ✗ ${date} (failed to persist)`);
      }
    }
  }

  if (blocked > 0) {
    die(
      `${blocked} day(s) skipped to avoid dropping prior activity. ` +
        `Re-run with the correct --project scope, or pass --force to overwrite.`,
    );
  }
}

async function runAppendSession(args: ParsedArgs): Promise<void> {
  const repo = args.repo ?? process.env['CHRONICLE_REPO'];
  let project = args.project ?? process.env['CHRONICLE_PROJECT'];
  let sessionId = args.sessionId;
  let sourceHint: string | undefined;

  // Stop hook mode: read JSON payload from stdin when session-id not provided.
  if (!sessionId) {
    const payload = await readStdin();
    if (!payload.trim())
      die(
        '--session-id is required, or pipe a JSON payload from the Stop hook',
      );
    let hookData: Record<string, string>;
    try {
      hookData = JSON.parse(payload);
    } catch {
      die(`could not parse stdin as JSON: ${payload.slice(0, 100)}`);
    }
    sessionId = hookData['session_id'];
    sourceHint = hookData['source'];
    // cwd from the hook payload scopes the project if not set explicitly.
    if (!project && hookData['cwd']) {
      project = hookData['cwd'];
    }
  }

  if (!sessionId) die('could not determine session_id');
  if (!repo && !args.dryRun)
    die('--repo <path> (or $CHRONICLE_REPO) is required');

  project = project ?? process.cwd();

  // Cursor sessions are attributed to their creation day, so a stop event for
  // a session whose later turns crossed midnight must regenerate that day, not
  // today. Claude sessions anchor to in-window user records, so today's window
  // already captures them correctly.
  let date = today();
  if (sourceHint === 'cursor') {
    const cursorRepo = buildContainer().get<ICursorRepository>(
      CHRONICLE_TOKENS.CursorRepository,
    );
    const sessionDate = await cursorRepo.findSessionDate(sessionId);
    if (sessionDate) date = sessionDate;
  }

  const calendar = args.calendar ?? process.env['CHRONICLE_CALENDAR'];

  const input: DailyChronicleInput = {
    window: { start: date, end: date },
    ...gitScope(args.gitRepo, project),
    jiraTicketKeys: [],
    claudeCodeProjectPath: project,
    cursorProjectPath: project,
    force: args.force,
    ...(calendar ? { calendarIcsPath: calendar } : {}),
    ...(repo && !args.dryRun ? { outputRepoPath: repo } : {}),
  };

  const handler = getDailyChronicleHandler();
  const result = await handler.handle(input);

  if (args.dryRun) {
    console.log(result.chronicle.markdown);
  } else if (result.clobberPrevented) {
    // Live-capture path (often Stop-hook driven): the guard warns rather than
    // hard-failing, since a hook can neither prompt nor act on an exit code.
    reportClobber(date, result.clobberPrevented);
    console.error(
      `chronicle: session ${sessionId.slice(0, 8)} not persisted — would drop prior activity. ` +
        `Re-run with the correct --project scope, or --force to overwrite.`,
    );
  } else {
    const p = result.persisted;
    if (p?.committed) {
      console.error(
        `chronicle: appended session ${sessionId.slice(0, 8)} → ${p.path}`,
      );
    } else if (p) {
      console.error(
        `chronicle: session ${sessionId.slice(0, 8)} already recorded (${p.path})`,
      );
    } else {
      console.error(
        `chronicle: session ${sessionId.slice(0, 8)} — no repo to persist to`,
      );
    }
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    // Non-TTY stdin that never sends EOF (e.g. no piped input) — resolve empty after 100ms.
    if (process.stdin.isTTY) resolve('');
  });
}

/** Return all ISO dates in [start, end] inclusive. */
function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  // Parse as UTC noon to avoid DST edge cases on date arithmetic.
  let cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return dates;
}

async function runQueue(args: ParsedArgs): Promise<void> {
  const repo = args.repo ?? process.env['CHRONICLE_REPO'];
  if (!repo)
    die('--repo <path> (or $CHRONICLE_REPO) is required for queue commands');

  const container = buildContainer();
  const store = container.get<IQueueStore>(CHRONICLE_TOKENS.QueueStore);
  const sub = args.subcommand ?? 'show';

  switch (sub) {
    case 'show': {
      const items = await store.read(repo);
      const todayDate = today();
      console.log(formatQueueSummary(items, todayDate));
      break;
    }

    case 'add': {
      const title = args.title;
      if (!title) die('chronicle queue add: title is required');
      const refs = [];
      const signals = [];
      if (args.jira) refs.push({ type: 'jira' as const, key: args.jira });
      if (args.prd) refs.push({ type: 'prd' as const, key: args.prd });
      if (args.due) signals.push({ type: 'due' as const, value: args.due });

      const stableKey = refs.find(
        (r) => r.type === 'jira' || r.type === 'prd',
      )?.key;
      const id = stableKey ? queueItemId(stableKey) : queueItemId(title);
      const item: QueueItem = {
        id,
        title,
        state: 'inbox',
        refs,
        signals,
        addedAt: new Date().toISOString(),
      };
      await store.append(repo, item);
      console.log(`Added to Inbox: ${title}`);
      break;
    }

    case 'done': {
      const titleOrId = args.title;
      if (!titleOrId) die('chronicle queue done: title or id is required');
      const items = await store.read(repo);
      const targetId =
        titleOrId.length === 12 && /^[0-9a-f]+$/.test(titleOrId)
          ? titleOrId
          : queueItemId(titleOrId);
      const idx = items.findIndex(
        (i) => i.id === targetId || i.title === titleOrId,
      );
      if (idx === -1)
        die(`chronicle queue done: no item matching "${titleOrId}"`);
      const updated: QueueItem[] = items.map((item, i) =>
        i === idx
          ? {
              ...item,
              state: 'done' as const,
              closedAt: new Date().toISOString(),
            }
          : item,
      );
      await store.write(repo, updated);
      console.log(`Done: ${items[idx].title}`);
      break;
    }

    case 'list': {
      const items = await store.read(repo);
      const filtered = args.state
        ? items.filter((i) => i.state === args.state)
        : items;
      const todayDate = today();
      const ordered =
        args.state === 'next' || !args.state
          ? [
              ...filtered.filter((i) => i.state === 'active'),
              ...prioritizeNext(filtered, todayDate),
              ...filtered.filter((i) => i.state === 'inbox'),
              ...filtered.filter((i) => i.state === 'done'),
            ]
          : filtered;
      if (ordered.length === 0) {
        console.log('No items.');
        break;
      }
      for (const item of ordered) {
        const dueSignal = item.signals.find((s) => s.type === 'due');
        const blockedSignal = item.signals.find((s) => s.type === 'blocked');
        const primaryRef = item.refs.find(
          (r) => r.type === 'jira' || r.type === 'prd',
        );
        const check = item.state === 'done' ? 'x' : ' ';
        const tags = [
          primaryRef ? `[${primaryRef.type}:${primaryRef.key}]` : '',
          dueSignal ? `[due:${dueSignal.value}]` : '',
          blockedSignal ? `[blocked:${blockedSignal.value}]` : '',
        ]
          .filter(Boolean)
          .join(' ');
        console.log(`- [${check}] ${item.title}${tags ? '  ' + tags : ''}`);
      }
      break;
    }

    default:
      die(`chronicle queue: unknown subcommand '${sub}'`);
  }
}

async function runInventoryChatgpt(args: ParsedArgs): Promise<void> {
  const exportPath = args.exportPath;
  if (!exportPath) die('--export <path> is required for inventory-chatgpt');
  const handler = getChatGptInventoryHandler();
  const inventory = await handler.handle({ exportPath });
  console.log(JSON.stringify(inventory, null, 2));
  if (inventory.status !== 'ok') process.exit(1);
}

async function runImportChatgpt(args: ParsedArgs): Promise<void> {
  const exportPath = args.exportPath;
  if (!exportPath) die('--export <path> is required for import-chatgpt');
  const repo = args.repo ?? process.env['CHRONICLE_REPO'];
  if (!repo)
    die('--repo <path> (or $CHRONICLE_REPO) is required for import-chatgpt');
  const handler = getChatGptImportHandler();
  const result = await handler.handle({
    exportPath,
    repoPath: repo,
    dryRun: args.dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'missing' || result.status === 'invalid') {
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  switch (args.command) {
    case 'backfill':
      await runBackfill(args);
      break;
    case 'append-session':
      await runAppendSession(args);
      break;
    case 'queue':
      await runQueue(args);
      break;
    case 'inventory-chatgpt':
      await runInventoryChatgpt(args);
      break;
    case 'import-chatgpt':
      await runImportChatgpt(args);
      break;
    default:
      console.error(`chronicle: unknown command '${args.command}'\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('chronicle:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
