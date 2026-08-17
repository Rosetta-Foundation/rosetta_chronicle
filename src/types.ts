/**
 * Boundary / DTO types for Chronicle.
 *
 * These are the contract shared between source repositories, the synthesis
 * service, and downstream consumers. Never duplicate these as local interfaces.
 */

/**
 * Marker appended to a session summary whose title was derived from a fallback
 * heuristic rather than a distilled title. Part of the wire contract: the
 * producing repository appends it and sets `reviewNeeded`, and the render layer
 * strips it. Kept in one place so producer and consumer can never drift.
 */
export const NEEDS_REVIEW_MARKER = '[needs-review]';

/** The activity sources Chronicle can observe. New sources are added here. */
export type ActivitySource =
  | 'git'
  | 'jira'
  | 'claude-code'
  | 'cursor'
  | 'notes'
  | 'calendar'
  | 'chatgpt-export';

// future: 'github' | 'slack' | 'confluence'
// `chatgpt-export` is Phase 1 inventory-aware only — Daily Chronicle
// synthesis does not collect it (PRD-0027).
/** The Rosetta tag taxonomy (see docs/mvp.md). */
export type Tag =
  | 'DELIVERY'
  | 'RELIABILITY'
  | 'PERFORMANCE'
  | 'CROSS-TEAM'
  | 'ARCH'
  | 'OBSERVABILITY'
  | 'SECURITY'
  | 'DEV'
  | 'LEVERAGE';

/** A reference back to the source artifact that justifies a statement. */
export interface Evidence {
  /** Which source this evidence came from. */
  source: ActivitySource;
  /** Stable identifier within the source (commit SHA, ticket key, message id, …). */
  ref: string;
  /** Human-readable description of the evidence. */
  description: string;
  /** Optional link to the artifact. */
  url?: string;
}

/** A single observed engineering event from a source. */
export interface Activity {
  source: ActivitySource;
  /** Stable identifier within the source. */
  id: string;
  /** ISO-8601 timestamp of when the activity occurred. */
  timestamp: string;
  /** Short summary of the activity. */
  summary: string;
  /** Supporting evidence for this activity. */
  evidence: Evidence[];
  /**
   * When true, the activity's summary was derived from a fallback heuristic
   * (e.g. truncated first prompt) rather than a high-quality distilled title.
   * Render layers should surface these in a "needs review" subsection.
   */
  reviewNeeded?: boolean;
  /**
   * For git activity, the slug (directory basename) of the repository this
   * activity originated from. Lets the render layer group commits by repo when
   * a Chronicle spans multiple repositories discovered under a workspace root.
   */
  repo?: string;
}

/** Options controlling git repository discovery under a root directory. */
export interface DiscoveryOptions {
  /** Maximum directory depth to walk below the root. */
  maxDepth?: number;
  /** Directory names to skip while walking (e.g. `node_modules`). */
  ignore?: string[];
  /**
   * Include merge commits in git activity. Never hardcoded — threaded through to
   * `git log`. Defaults to false (merge commits are noise in a daily activity log).
   */
  includeMerges?: boolean;
}

/** The window a chronicle covers. v0.1 is a single day. */
export interface ChronicleWindow {
  /** ISO-8601 date (inclusive). */
  start: string;
  /** ISO-8601 date (inclusive). */
  end: string;
}

/** Inputs required to generate a Daily Chronicle (see docs/mvp.md). */
export interface DailyChronicleInput {
  window: ChronicleWindow;
  /**
   * Absolute path to a single git repository to inspect. When
   * `workspaceRoot` is also set, this repo is unioned with the discovered ones.
   */
  gitRepoPath: string;
  /**
   * Absolute path to a workspace root under which every git repository is
   * discovered and its in-window commits included. When set, git activity is
   * aggregated across all discovered repos (plus `gitRepoPath`), each attributed
   * to its origin repo. When omitted, only `gitRepoPath` is inspected.
   */
  workspaceRoot?: string;
  /** Options controlling repository discovery when `workspaceRoot` is set. */
  discovery?: DiscoveryOptions;
  /** Jira ticket keys in scope for the day. */
  jiraTicketKeys: string[];
  /**
   * Absolute path of the project to scope Claude Code session extraction to.
   * Matched against the session cwd prefix, so a workspace root naturally
   * captures cross-repo sessions. When omitted, Claude Code activity is not
   * included.
   */
  claudeCodeProjectPath?: string;
  /**
   * Absolute path of the project to scope Cursor agent session extraction to.
   * Matched against the Cursor per-project directory slug prefix, so a
   * workspace root naturally captures cross-repo sessions. When omitted,
   * Cursor activity is not included.
   */
  cursorProjectPath?: string;
  /**
   * Absolute path to an iCalendar (`.ics`) export to read the day's meetings
   * from (PRD-0003 Phase 2). When omitted, calendar activity is not included.
   */
  calendarIcsPath?: string;
  /** Free-form manual notes for the day. */
  notes?: string;
  /**
   * Absolute path to the personal Chronicle repository to persist the generated
   * document into. When omitted, the Chronicle is generated but not written.
   */
  outputRepoPath?: string;
  /**
   * Raw Markdown of the existing Chronicle for this window, if one has already
   * been committed. Retained only as a migration fallback for pre-PRD-0002-Phase-2
   * days that have no structured sidecar — `priorTags` is preferred.
   * Populated by the handler before calling the service.
   */
  existingMarkdown?: string;
  /**
   * Tags carried over from a prior run, read by the handler from the structured
   * sidecar (the source of truth). When present, the service unions these with
   * freshly inferred tags instead of scraping them from `existingMarkdown`.
   */
  priorTags?: Tag[];
  /**
   * Bypass the regeneration clobber guard (PRD-0005) and persist even when the
   * freshly-collected activity is a strict subset of a prior run's — i.e. when
   * activity would be dropped. Use for legitimately-shrinking regenerations.
   */
  force?: boolean;
  /**
   * Do not persist a Chronicle for a day with zero collected activity, unless
   * a prior Chronicle already exists for that day. Set by range operations
   * (backfill, the catch-up sweep) so quiet days — weekends, vacations — never
   * commit empty documents.
   */
  skipEmpty?: boolean;
}

/** The result of persisting a generated Chronicle to a repository. */
export interface PersistedChronicle {
  /** Absolute path of the written Markdown file. */
  path: string;
  /** True when the write was committed to git. */
  committed: boolean;
}

/** A single synthesized section of the Daily Chronicle document. */
export interface ChronicleSection {
  heading: string;
  body: string;
  evidence: Evidence[];
}

/** The synthesized Daily Chronicle output (the v0.1 deliverable). */
export interface DailyChronicle {
  window: ChronicleWindow;
  sections: ChronicleSection[];
  tags: Tag[];
  /** Rendered Markdown document. */
  markdown: string;
  /**
   * The structured activity behind the render, grouped for the durable sidecar.
   * This — not the Markdown — is the source of truth a regeneration reads back
   * (PRD-0002 Phase 2), so tags and activity are never recovered by re-parsing
   * rendered output.
   */
  data: DailyChronicleData;
}

/**
 * Durable structured record of a day's Chronicle, persisted as JSON alongside
 * the rendered Markdown. The synthesis reads this back on regeneration instead
 * of scraping the rendered document.
 */
export interface DailyChronicleData {
  window: ChronicleWindow;
  /** Union of inferred + carried-over tags, in taxonomy order. */
  tags: Tag[];
  /** All activity that fed the render, across every source and repo. */
  activities: Activity[];
}

// ─── Personal Work Queue (PRD-0007) ──────────────────────────────────────────

/** External reference linking a queue item to a source system. */
export interface QueueRef {
  /** The source system type. */
  type: 'jira' | 'prd' | 'pr' | 'follow-up' | 'idea' | 'slack';
  /** External id: Jira key, PRD phase id (e.g. "0007/1"), PR number, etc. */
  key: string;
  /** Optional URL for linking. */
  url?: string;
}

/** A priority or sequencing signal attached to a queue item. */
export interface QueueSignal {
  type: 'due' | 'blocked' | 'momentum' | 'dependency';
  /** ISO date, blocking reason, repo name, or dependency item id. */
  value: string;
}

/** Lifecycle state of a queue item. */
export type QueueState = 'active' | 'next' | 'inbox' | 'done';

// ─── ChatGPT export inventory (PRD-0027 Phase 1) ─────────────────────────────

/** How the export was presented to the inventory command. */
export type ChatGptExportKind = 'directory' | 'archive';

/** Outcome of a read-only inventory. Never writes a Chronicle. */
export type ChatGptInventoryStatus = 'ok' | 'missing' | 'invalid';

/** Input to the ChatGPT export inventory handler. */
export interface ChatGptInventoryInput {
  /** Absolute path to an export directory or `.zip` archive. */
  exportPath: string;
  /**
   * Ingestion time (ISO-8601). Distinct from event time derived from the
   * export. Tests pass a fixed value; the handler defaults to now.
   */
  ingestedAt?: string;
}

/** Structural shape of one content part — never the part payload. */
export interface ChatGptPartShape {
  kind: 'string' | 'object' | 'null' | 'other';
  /** For object parts, `content_type` or `type` when present. */
  objectType?: string;
}

/** Attachment metadata kept after source content is stripped. */
export interface ChatGptAttachmentRef {
  id?: string;
  mimeType?: string;
  size?: number;
  libraryFileId?: string;
  presentInArchive: boolean;
}

/** One structurally-unsupported or unreadable record. */
export interface ChatGptUnsupportedRecord {
  conversationId?: string;
  nodeId?: string;
  reason: string;
}

/** Per-conversation structural inventory. No titles or message text. */
export interface ChatGptConversationInventory {
  sourceId: string;
  nodeCount: number;
  messageNodeCount: number;
  nullMessageNodeCount: number;
  roleCounts: Record<string, number>;
  contentTypes: string[];
  attachmentRefCount: number;
  /** True when any parent has more than one child (source or reconstructed). */
  branched: boolean;
  currentNodeId?: string;
  createTime?: string;
  updateTime?: string;
  hasMissingMessageTimestamps: boolean;
  archived: boolean;
}

/**
 * Stripped conversation node passed from the export repository to the
 * inventory service. Source text and titles are never included.
 */
export interface ChatGptRawNode {
  id?: string;
  parentId?: string | null;
  /** Source `children` array when present; otherwise empty. */
  sourceChildIds: string[];
  hasMessage: boolean;
  role?: string;
  createTime?: number;
  updateTime?: number;
  contentType?: string;
  partShapes: ChatGptPartShape[];
  hasParts: boolean;
  attachmentRefs: Omit<ChatGptAttachmentRef, 'presentInArchive'>[];
  malformedReasons: string[];
}

/** Stripped conversation. Title and message text are discarded at read time. */
export interface ChatGptRawConversation {
  sourceId?: string;
  createTime?: number;
  updateTime?: number;
  currentNodeId?: string;
  archived: boolean;
  nodes: ChatGptRawNode[];
  malformedReasons: string[];
}

/** Filesystem read of an export after content stripping. */
export interface ChatGptRawExport {
  kind: ChatGptExportKind;
  contentHash: string;
  shardNames: string[];
  sidecarFiles: string[];
  archiveFiles: string[];
  conversations: ChatGptRawConversation[];
  unsupported: ChatGptUnsupportedRecord[];
}

/** Repository result: missing/invalid stay explicit, never thrown as inventory. */
export type ChatGptExportReadResult =
  | { ok: true; export: ChatGptRawExport }
  | { ok: false; reason: 'missing' | 'invalid'; message: string };

/** Derived inventory of a ChatGPT export. Contains no source message text. */
export interface ChatGptExportInventory {
  status: ChatGptInventoryStatus;
  sourceKind?: ChatGptExportKind;
  sourcePath: string;
  /** SHA-256 of the archive file, or of sorted conversation shards. */
  contentHash?: string;
  /** When this inventory ran — not when the underlying events occurred. */
  ingestedAt: string;
  /** Min/max event time from conversation and message timestamps. */
  eventTimeRange?: { start: string; end: string };
  conversationCount: number;
  nodeCount: number;
  messageNodeCount: number;
  roleCounts: Record<string, number>;
  contentTypes: string[];
  attachmentRefCount: number;
  attachmentsPresent: number;
  attachmentsMissing: number;
  conversationsWithBranches: number;
  shardCount: number;
  sidecarFiles: string[];
  privacySignals: string[];
  unsupported: ChatGptUnsupportedRecord[];
  conversations: ChatGptConversationInventory[];
  error?: string;
}

/** A single item in the personal work queue. */
export interface QueueItem {
  /** Stable id (content-hash of title, or sourced from a ref key). */
  id: string;
  /** One-line description of the work. */
  title: string;
  /** Current state in the queue. */
  state: QueueState;
  /** External references for dedup and eventual auto-close. */
  refs: QueueRef[];
  /** Priority signals attached to this item. */
  signals: QueueSignal[];
  /** ISO-8601 timestamp when the item was added. */
  addedAt: string;
  /** ISO-8601 timestamp when moved to done. */
  closedAt?: string;
  /** Activity id (from the Chronicle sidecar) that closed it. */
  closedBy?: string;
}
