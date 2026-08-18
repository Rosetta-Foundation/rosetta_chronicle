#!/usr/bin/env node
import 'reflect-metadata';
import {
  getDailyChronicleHandler,
  getChatGptInventoryHandler,
  getChatGptImportHandler,
  getDerivedRecordHandler,
  getTransformationHandler,
  getProvenanceHandler,
  buildContainer,
} from '../index';
import {
  DailyChronicleInput,
  DerivedProducerType,
  DerivedReviewState,
  DerivedTransformationType,
  ProvenanceDirection,
  QueueItem,
  QueueState,
} from '../types';
import { parseProvenanceFrom } from '../utils/provenance-graph.utils';
import { readFileSync } from 'fs';
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
 *   chronicle record-derived      Persist a provenance-preserving derived record.
 *   chronicle transform-record    Run a named transformation and persist execution.
 *   chronicle transformation-provenance
 *                                 Walk or compare transformation executions.
 *   chronicle provenance          First-class backward/forward graph walk.
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
  chronicle import-chatgpt --export <path> --output <dir> [--dry-run]
  chronicle record-derived --output <dir> --source-graph-hash <hex> --type <kind> --producer-type <human|agent> --producer-name <name> --content <text> [--dry-run]
  chronicle transform-record --type <kind> --version <n> --source-graph-hash <hex> --output <dir> --executions <dir> --definitions <dir> --producer-type <human|agent> --producer-name <name> --content <text> [--dry-run]
  chronicle transformation-provenance --derived <id> --output <dir> --executions <dir> --definitions <dir>
  chronicle transformation-provenance --execution <id> --executions <dir> --definitions <dir>
  chronicle transformation-provenance --definition <id> --definitions <dir> --executions <dir>
  chronicle transformation-provenance --source-graph-hash <hex> --executions <dir>
  chronicle transformation-provenance --compare <id> --with <id> --executions <dir>
  chronicle provenance --from <kind>:<id> --direction backward|forward --graphs <dir> --output <dir> --executions <dir> --definitions <dir>
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
  import-chatgpt      Persist a stripped conversation graph to --output as
                      a content-hash JSON file. Idempotent by archive hash.
                      Does not emit Activity or write a Daily Chronicle.
  record-derived      Persist a derived record (human note, later AI
                      transformation) with source-graph provenance. Does
                      not emit Activity or write a Daily Chronicle.
  transform-record    Run a named registry transformation and persist an
                      immutable execution plus derived output. Does not
                      emit Activity or write a Daily Chronicle.
  transformation-provenance
                      Narrow compatibility helper: single-hop execution
                      walks and compare. Not the general graph API.
  provenance          First-class backward/forward provenance graph walk
                      over source, definition, execution, and derived
                      records. Does not emit Activity.

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
  --output <dir>      Directory for import-chatgpt, record-derived, or
                      transform-record derived JSON. Caller-chosen; the
                      engine does not assume a personal Chronicle layout.
                      Falls back to $CHRONICLE_SOURCE_GRAPH_DIR or
                      $CHRONICLE_DERIVED_DIR.
  --executions <dir>  Directory for transformation execution JSON.
                      Falls back to $CHRONICLE_EXECUTION_DIR.
  --definitions <dir> Directory for persisted transformation definitions.
                      Falls back to $CHRONICLE_DEFINITION_DIR.
  --graphs <dir>      Directory of source-graph JSON files.
                      Falls back to $CHRONICLE_SOURCE_GRAPH_DIR.
  --from <kind>:<id>  Start of chronicle provenance (derived-record,
                      execution, definition, source-archive,
                      source-conversation, source-node).
  --direction <dir>   backward | forward (chronicle provenance).
  --source-graph-hash <hex>
                      Archive content hash the derived record cites.
  --source-ref <hex>  Alias for --source-graph-hash.
  --version <n>       Transformation recipe version (default 1).
  --config <json>     Optional JSON object stored on the execution.
  --derived <id>      Derived-record id for transformation-provenance.
  --execution <id>    Execution id for transformation-provenance.
  --definition <id>   Definition id for transformation-provenance.
  --compare <id>      First execution id to compare.
  --with <id>         Second execution id to compare.
  --conversation-id <id>
                      Optional conversation id on the source graph.
  --node-id <id>      Optional source-graph node id (repeatable).
  --type <kind>       Derived transformation type (human-note, reflection,
                      summary, insight, decision, activity-candidate,
                      revision).
  --producer-type <human|agent>
                      Who created the derived content.
  --producer-name <name>
                      Producer display name.
  --model <id>        Required when --producer-type is agent.
  --prompt-version <id>
                      Optional prompt/version identity for an agent.
  --content <text>    Human-created derived body (synthetic in tests).
  --content-file <path>
                      Read derived body from a file instead of --content.
  --graph <path>      Optional source-graph JSON to validate refs against.
  --confidence <n>    Optional 0..1 confidence.
  --review-state <state>
                      unreviewed | recognized | rejected | corrected |
                      uncertain. Defaults: human=recognized, agent=unreviewed.
  -h, --help          Show this help.

Environment variables:
  CHRONICLE_REPO      Default value for --repo.
  CHRONICLE_PROJECT   Default value for --project.
  CHRONICLE_CALENDAR  Default value for --calendar (path to .ics export).
  CHRONICLE_SOURCE_GRAPH_DIR
                      Default --output for import-chatgpt and --graphs
                      for provenance.
  CHRONICLE_DERIVED_DIR
                      Default --output for record-derived,
                      transform-record, and provenance.
  CHRONICLE_EXECUTION_DIR
                      Default --executions for transform-record,
                      transformation-provenance, and provenance.
  CHRONICLE_DEFINITION_DIR
                      Default --definitions for transform-record,
                      transformation-provenance, and provenance.
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
  outputDir?: string;
  sourceGraphHash?: string;
  conversationId?: string;
  nodeIds: string[];
  transformationType?: string;
  producerType?: string;
  producerName?: string;
  model?: string;
  promptVersion?: string;
  content?: string;
  contentFile?: string;
  graphPath?: string;
  confidence?: number;
  reviewState?: string;
  executionsDir?: string;
  definitionsDir?: string;
  definitionId?: string;
  transformationVersion?: string;
  configJson?: string;
  derivedId?: string;
  executionId?: string;
  compareId?: string;
  withId?: string;
  graphsDir?: string;
  fromRef?: string;
  direction?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: '',
    dryRun: false,
    force: false,
    nodeIds: [],
  };

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
      case '--output':
        result.outputDir = args[++i];
        break;
      case '--source-graph-hash':
      case '--source-ref':
        result.sourceGraphHash = args[++i];
        break;
      case '--executions':
        result.executionsDir = args[++i];
        break;
      case '--definitions':
        result.definitionsDir = args[++i];
        break;
      case '--graphs':
        result.graphsDir = args[++i];
        break;
      case '--from':
        result.fromRef = args[++i];
        break;
      case '--direction':
        result.direction = args[++i];
        break;
      case '--definition':
        result.definitionId = args[++i];
        break;
      case '--version':
        result.transformationVersion = args[++i];
        break;
      case '--config':
        result.configJson = args[++i];
        break;
      case '--derived':
        result.derivedId = args[++i];
        break;
      case '--execution':
        result.executionId = args[++i];
        break;
      case '--compare':
        result.compareId = args[++i];
        break;
      case '--with':
        result.withId = args[++i];
        break;
      case '--conversation-id':
        result.conversationId = args[++i];
        break;
      case '--node-id':
        result.nodeIds.push(args[++i]);
        break;
      case '--type':
        result.transformationType = args[++i];
        break;
      case '--producer-type':
        result.producerType = args[++i];
        break;
      case '--producer-name':
        result.producerName = args[++i];
        break;
      case '--model':
        result.model = args[++i];
        break;
      case '--prompt-version':
        result.promptVersion = args[++i];
        break;
      case '--content':
        result.content = args[++i];
        break;
      case '--content-file':
        result.contentFile = args[++i];
        break;
      case '--graph':
        result.graphPath = args[++i];
        break;
      case '--confidence':
        result.confidence = Number(args[++i]);
        break;
      case '--review-state':
        result.reviewState = args[++i];
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
  const outputDir = args.outputDir ?? process.env['CHRONICLE_SOURCE_GRAPH_DIR'];
  if (!outputDir)
    die(
      '--output <dir> (or $CHRONICLE_SOURCE_GRAPH_DIR) is required for import-chatgpt',
    );
  const handler = getChatGptImportHandler();
  const result = await handler.handle({
    exportPath,
    outputDir,
    dryRun: args.dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'missing' || result.status === 'invalid') {
    process.exit(1);
  }
}

async function runRecordDerived(args: ParsedArgs): Promise<void> {
  const outputDir = args.outputDir ?? process.env['CHRONICLE_DERIVED_DIR'];
  if (!outputDir)
    die(
      '--output <dir> (or $CHRONICLE_DERIVED_DIR) is required for record-derived',
    );
  if (!args.sourceGraphHash)
    die('--source-graph-hash is required for record-derived');
  if (!args.transformationType) die('--type is required for record-derived');
  if (!args.producerType)
    die('--producer-type is required for record-derived');
  if (!args.producerName)
    die('--producer-name is required for record-derived');
  let content = args.content;
  if (args.contentFile) {
    content = readFileSync(args.contentFile, 'utf-8');
  }
  if (content == null) die('--content or --content-file is required');
  const handler = getDerivedRecordHandler();
  const result = await handler.handle({
    outputDir,
    sourceGraphHash: args.sourceGraphHash,
    conversationId: args.conversationId,
    nodeIds: args.nodeIds,
    transformationType: args.transformationType as DerivedTransformationType,
    createdBy: {
      type: args.producerType as DerivedProducerType,
      name: args.producerName,
      ...(args.model ? { model: args.model } : {}),
      ...(args.promptVersion ? { promptVersion: args.promptVersion } : {}),
    },
    content,
    ...(args.confidence != null && !Number.isNaN(args.confidence)
      ? { confidence: args.confidence }
      : {}),
    ...(args.reviewState
      ? { reviewState: args.reviewState as DerivedReviewState }
      : {}),
    graphPath: args.graphPath,
    dryRun: args.dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'invalid') process.exit(1);
}

async function runTransformRecord(args: ParsedArgs): Promise<void> {
  const outputDir = args.outputDir ?? process.env['CHRONICLE_DERIVED_DIR'];
  if (!outputDir)
    die(
      '--output <dir> (or $CHRONICLE_DERIVED_DIR) is required for transform-record',
    );
  const executionsDir =
    args.executionsDir ?? process.env['CHRONICLE_EXECUTION_DIR'];
  if (!executionsDir)
    die(
      '--executions <dir> (or $CHRONICLE_EXECUTION_DIR) is required for transform-record',
    );
  const definitionsDir =
    args.definitionsDir ?? process.env['CHRONICLE_DEFINITION_DIR'];
  if (!definitionsDir)
    die(
      '--definitions <dir> (or $CHRONICLE_DEFINITION_DIR) is required for transform-record',
    );
  if (!args.sourceGraphHash)
    die('--source-graph-hash (or --source-ref) is required for transform-record');
  if (!args.transformationType) die('--type is required for transform-record');
  if (!args.producerType)
    die('--producer-type is required for transform-record');
  if (!args.producerName)
    die('--producer-name is required for transform-record');
  let content = args.content;
  if (args.contentFile) {
    content = readFileSync(args.contentFile, 'utf-8');
  }
  if (content == null) die('--content or --content-file is required');
  let configuration: Record<string, unknown> | undefined;
  if (args.configJson) {
    try {
      const parsed: unknown = JSON.parse(args.configJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        die('--config must be a JSON object');
      }
      configuration = parsed as Record<string, unknown>;
    } catch {
      die('--config must be valid JSON');
    }
  }
  const handler = getTransformationHandler();
  const result = await handler.handle({
    outputDir,
    executionsDir,
    definitionsDir,
    sourceGraphHash: args.sourceGraphHash,
    conversationId: args.conversationId,
    nodeIds: args.nodeIds,
    transformationType: args.transformationType as DerivedTransformationType,
    transformationVersion: args.transformationVersion ?? '1',
    createdBy: {
      type: args.producerType as DerivedProducerType,
      name: args.producerName,
      ...(args.model ? { model: args.model } : {}),
      ...(args.promptVersion ? { promptVersion: args.promptVersion } : {}),
    },
    content,
    ...(configuration ? { configuration } : {}),
    ...(args.confidence != null && !Number.isNaN(args.confidence)
      ? { confidence: args.confidence }
      : {}),
    ...(args.reviewState
      ? { reviewState: args.reviewState as DerivedReviewState }
      : {}),
    graphPath: args.graphPath,
    dryRun: args.dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'invalid') process.exit(1);
}

async function runTransformationProvenance(args: ParsedArgs): Promise<void> {
  const executionsDir =
    args.executionsDir ?? process.env['CHRONICLE_EXECUTION_DIR'];
  if (!executionsDir)
    die(
      '--executions <dir> (or $CHRONICLE_EXECUTION_DIR) is required for transformation-provenance',
    );
  const definitionsDir =
    args.definitionsDir ?? process.env['CHRONICLE_DEFINITION_DIR'];
  const needsDefinitions = Boolean(
    args.derivedId || args.executionId || args.definitionId,
  );
  if (needsDefinitions && !definitionsDir) {
    die(
      '--definitions <dir> (or $CHRONICLE_DEFINITION_DIR) is required when walking from --derived, --execution, or --definition',
    );
  }
  const handler = getTransformationHandler();
  const result = await handler.provenance({
    executionsDir,
    definitionsDir,
    outputDir: args.outputDir ?? process.env['CHRONICLE_DERIVED_DIR'],
    derivedId: args.derivedId,
    executionId: args.executionId,
    definitionId: args.definitionId,
    sourceGraphHash: args.sourceGraphHash,
    compareId: args.compareId,
    withId: args.withId,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'ok') process.exit(1);
}

async function runProvenance(args: ParsedArgs): Promise<void> {
  if (!args.fromRef) die('--from <kind>:<id> is required for provenance');
  if (args.direction !== 'backward' && args.direction !== 'forward') {
    die('--direction backward|forward is required for provenance');
  }
  const parsed = parseProvenanceFrom(args.fromRef);
  if (!parsed.ref) die(parsed.error ?? 'from-unparseable');
  const outputDir = args.outputDir ?? process.env['CHRONICLE_DERIVED_DIR'];
  if (!outputDir)
    die('--output <dir> (or $CHRONICLE_DERIVED_DIR) is required for provenance');
  const executionsDir =
    args.executionsDir ?? process.env['CHRONICLE_EXECUTION_DIR'];
  if (!executionsDir)
    die(
      '--executions <dir> (or $CHRONICLE_EXECUTION_DIR) is required for provenance',
    );
  const definitionsDir =
    args.definitionsDir ?? process.env['CHRONICLE_DEFINITION_DIR'];
  if (!definitionsDir)
    die(
      '--definitions <dir> (or $CHRONICLE_DEFINITION_DIR) is required for provenance',
    );
  const graphsDir =
    args.graphsDir ?? process.env['CHRONICLE_SOURCE_GRAPH_DIR'];
  if (!graphsDir)
    die(
      '--graphs <dir> (or $CHRONICLE_SOURCE_GRAPH_DIR) is required for provenance',
    );
  const handler = getProvenanceHandler();
  const result = await handler.handle({
    start: parsed.ref,
    direction: args.direction as ProvenanceDirection,
    graphsDir,
    outputDir,
    executionsDir,
    definitionsDir,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'invalid' || result.status === 'not-found') {
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
    case 'record-derived':
      await runRecordDerived(args);
      break;
    case 'transform-record':
      await runTransformRecord(args);
      break;
    case 'transformation-provenance':
      await runTransformationProvenance(args);
      break;
    case 'provenance':
      await runProvenance(args);
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
