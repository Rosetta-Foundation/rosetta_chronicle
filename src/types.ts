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
  | 'calendar';

// future: 'github' | 'slack' | 'confluence' | 'chatgpt-export'
// `chatgpt-export` is not a member. Phase 2 persists a source graph, not
// Activity. Leave this union unchanged until a later phase emits Activity.
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

// ─── ChatGPT source graph (PRD-0027 Phase 2) ─────────────────────────────────

/** Attachment ref on a durable source-graph node. No display filename. */
export interface ChatGptSourceAttachmentRef {
  id?: string;
  presentInArchive: boolean;
  mimeType?: string;
  size?: number;
  libraryFileId?: string;
}

/**
 * Durable node in the normalized conversation graph. Topology and type only —
 * no message text. `sourceChildIds` is what the vendor wrote;
 * `reconstructedChildIds` is inferred from parent links.
 */
export interface ChatGptSourceNode {
  id: string;
  parentId?: string | null;
  sourceChildIds: string[];
  reconstructedChildIds: string[];
  hasMessage: boolean;
  role?: string;
  contentType?: string;
  createTime?: string;
  updateTime?: string;
  attachments: ChatGptSourceAttachmentRef[];
}

/** Durable conversation. Title is not stored. */
export interface ChatGptSourceConversation {
  sourceId: string;
  currentNodeId?: string;
  createTime?: string;
  updateTime?: string;
  archived: boolean;
  nodes: ChatGptSourceNode[];
}

/**
 * Archive identity for a persisted graph. Bytes stay outside the repository
 * in this phase; hash is the idempotency key.
 */
export interface ChatGptSourceArchive {
  contentHash: string;
  kind: ChatGptExportKind;
  importedAt: string;
  shardNames: string[];
  sidecarFiles: string[];
}

/**
 * Normalized ChatGPT conversation graph (PRD-0027 Phase 2). Source record,
 * not Activity. No titles, parts, or attachment bytes.
 */
export interface ChatGptSourceGraph {
  archive: ChatGptSourceArchive;
  conversations: ChatGptSourceConversation[];
  unsupported: ChatGptUnsupportedRecord[];
}

/** Input to the ChatGPT source-graph import handler. */
export interface ChatGptImportInput {
  exportPath: string;
  /**
   * Directory that will hold `<contentHash>.json`. Caller-chosen — the
   * engine does not encode a personal Chronicle layout.
   */
  outputDir: string;
  ingestedAt?: string;
  /** Build the graph and do not write. */
  dryRun?: boolean;
}

export type ChatGptImportStatus =
  | 'imported'
  | 'already-present'
  | 'missing'
  | 'invalid';

/** Result of a source-graph import. Never includes source text. */
export interface ChatGptImportResult {
  status: ChatGptImportStatus;
  contentHash?: string;
  path?: string;
  conversationCount: number;
  nodeCount: number;
  importedAt?: string;
  error?: string;
}

// ─── Derived records (PRD-0027 transformation layer) ─────────────────────────

/**
 * Kind of transformation. Caller-supplied kinds persist caller content.
 * `candidate-observation` is produced only by interpret-source.
 */
export type DerivedTransformationType =
  | 'human-note'
  | 'reflection'
  | 'summary'
  | 'insight'
  | 'decision'
  | 'activity-candidate'
  | 'revision'
  | 'candidate-observation';

/** Evaluation seed on a derived record. Full evaluation history is later. */
export type DerivedReviewState =
  | 'unreviewed'
  | 'recognized'
  | 'rejected'
  | 'corrected'
  | 'uncertain';

export type DerivedProducerType = 'human' | 'agent';

/** Who produced the transformation. Agent records require a model. */
export interface DerivedProducer {
  type: DerivedProducerType;
  name: string;
  model?: string;
  promptVersion?: string;
}

/**
 * Why this derived record exists. Points at source-graph structure, not
 * at Activity.
 */
export interface DerivedSourceRef {
  sourceGraphHash: string;
  conversationId?: string;
  nodeIds: string[];
}

/**
 * Inspectable transformation from a source graph. Not Activity, not a
 * graph backup. `id` is an immutable transformation *event* (this
 * producer, this content, these refs, this type/version) — not a
 * persistent conceptual artifact that can be edited in place. Content
 * is optional so a private store can hold the body while `contentRef`
 * remains the durable handle.
 */
export interface DerivedRecord {
  /** Immutable event id; not a living conceptual identity. */
  id: string;
  sourceRefs: DerivedSourceRef[];
  transformationType: DerivedTransformationType;
  transformationVersion: string;
  createdAt: string;
  createdBy: DerivedProducer;
  contentRef: string;
  content?: string;
  confidence?: number;
  reviewState: DerivedReviewState;
  /**
   * Link to the execution that produced this event. Not part of `id`.
   * Absent when the record was written with `record-derived` only.
   */
  executionId?: string;
}

/** Input to the derived-record handler. */
export interface DerivedRecordInput {
  outputDir: string;
  sourceGraphHash: string;
  conversationId?: string;
  nodeIds: string[];
  transformationType: DerivedTransformationType;
  createdBy: DerivedProducer;
  content: string;
  createdAt?: string;
  confidence?: number;
  reviewState?: DerivedReviewState;
  /** Optional source-graph JSON to validate refs against. */
  graphPath?: string;
  dryRun?: boolean;
}

export type DerivedRecordStatus =
  | 'recorded'
  | 'already-present'
  | 'invalid';

/** Result of recording a derived transformation. */
export interface DerivedRecordResult {
  status: DerivedRecordStatus;
  id?: string;
  path?: string;
  contentRef?: string;
  createdAt?: string;
  reviewState?: DerivedReviewState;
  error?: string;
}

// ─── Transformation registry / execution (PRD-0027) ──────────────────────────

/**
 * Epistemic specialization of a recipe. Optional on caller-supplied
 * recipes. When present it is hashed into definition identity.
 * Owns what claims are allowed, not how the model is sampled.
 */
export interface InterpretationPolicy {
  id: string;
  version: string;
  maxObservations: number;
  epistemicClasses: string[];
  outputSchemaId: string;
  promptTemplateId: string;
  promptTemplateHash: string;
}

/**
 * In-memory bootstrap recipe. Not a run and not an output.
 * Recipe `version` is independent of `DerivedRecord.transformationVersion`.
 */
export interface TransformationRecipe {
  type: DerivedTransformationType;
  version: string;
  description: string;
  deterministic: boolean;
  allowedProducerTypes: DerivedProducerType[];
  policy?: InterpretationPolicy;
}

/**
 * Persisted immutable recipe artifact. Identity is the content hash of
 * the recipe fields — not the execution that later cites it.
 */
export interface TransformationDefinition extends TransformationRecipe {
  id: string;
  createdAt: string;
  contentHash: string;
}

/**
 * One immutable run of a registered transformation. Owns process
 * identity, configuration, and output handles — not derived content or
 * review state. `definitionId` is the exact recipe artifact used.
 */
export interface TransformationExecution {
  id: string;
  definitionId: string;
  transformationType: DerivedTransformationType;
  transformationVersion: string;
  sourceRefs: DerivedSourceRef[];
  producer: DerivedProducer;
  createdAt: string;
  configuration: Record<string, unknown>;
  deterministic: boolean;
  outputRefs: string[];
  outputContentRefs: string[];
}

/** Input to the named-transformation handler. */
export interface TransformRecordInput {
  outputDir: string;
  executionsDir: string;
  definitionsDir: string;
  sourceGraphHash: string;
  conversationId?: string;
  nodeIds: string[];
  transformationType: DerivedTransformationType;
  transformationVersion: string;
  createdBy: DerivedProducer;
  content: string;
  /** Extra derived bodies from the same execution. CLI sends one. */
  extraContents?: string[];
  configuration?: Record<string, unknown>;
  createdAt?: string;
  confidence?: number;
  reviewState?: DerivedReviewState;
  graphPath?: string;
  dryRun?: boolean;
}

export type TransformRecordStatus =
  | 'recorded'
  | 'already-present'
  | 'invalid';

/** Result of running a named transformation. */
export interface TransformRecordResult {
  status: TransformRecordStatus;
  executionId?: string;
  executionPath?: string;
  definitionId?: string;
  definitionPath?: string;
  derivedIds?: string[];
  derivedPaths?: string[];
  createdAt?: string;
  error?: string;
}

// ─── Candidate observation (E4 machine interpretation) ───────────────────────

/**
 * One durable observation body. Never an array of observations.
 * `directly-supported` is a machine classification of support, not source.
 */
export type CandidateObservationPayload =
  | {
      schemaVersion: 'candidate-observation/1';
      result: 'observation';
      statement: string;
      epistemicClass: 'directly-supported' | 'inferred';
      citedNodeIds: string[];
      supportNote?: string;
    }
  | {
      schemaVersion: 'candidate-observation/1';
      result: 'insufficient-evidence';
      citedNodeIds: string[];
      supportNote?: string;
    };

/** What happened to the physical provider call. */
export type ProviderStatus = 'succeeded' | 'failed' | 'uncertain';

/** Epistemic result. Set only when the provider produced a schema-valid body. */
export type ExecutionOccurrenceOutcome =
  | 'observations'
  | 'insufficient-evidence';

export type ProviderFailureClass =
  | 'unavailable'
  | 'timeout'
  | 'refused'
  | 'invalid-output';

export type PersistenceStatus = 'committed' | 'not-committed';

/**
 * One physical provider invocation, written once at a terminal state.
 * Not a belief — TransformationExecution + DerivedRecord are the
 * epistemic artifacts. Persistence is a second axis: the provider can
 * succeed while Chronicle has not yet accepted the output as memory.
 */
export interface ExecutionOccurrence {
  id: string;
  definitionId: string;
  sourceRefs: DerivedSourceRef[];
  producer: DerivedProducer;
  configuration: Record<string, unknown>;
  startedAt: string;
  endedAt: string;
  nonce: string;
  providerStatus: ProviderStatus;
  outcome?: ExecutionOccurrenceOutcome;
  providerFailureClass?: ProviderFailureClass;
  persistenceStatus: PersistenceStatus;
  persistenceFailureClass?: 'persist-failed';
  executionId?: string;
  derivedIds?: string[];
  providerRequestId?: string;
  /** Concrete model/version the provider reported for this invoke. */
  modelVersion?: string;
}

/** Input to machine interpretation. Content is never caller-supplied. */
export interface InterpretSourceInput {
  exportPath: string;
  graphPath: string;
  sourceGraphHash: string;
  conversationId: string;
  nodeIds: string[];
  outputDir: string;
  executionsDir: string;
  definitionsDir: string;
  occurrencesDir: string;
  provider: string;
  model: string;
  temperature?: number;
  dryRun?: boolean;
  createdAt?: string;
  startedAt?: string;
  endedAt?: string;
  nonce?: string;
}

export type InterpretSourceStatus =
  | 'dry-run'
  | 'recorded'
  | 'already-present'
  | 'invalid'
  | 'unavailable'
  | 'uncertain'
  | 'refused'
  | 'invalid-output'
  | 'persist-failed'
  | 'occurrence-persist-failed';

/**
 * Result of interpret-source. Never includes source text or observation
 * statements — those paraphrase private material.
 */
export interface InterpretSourceResult {
  status: InterpretSourceStatus;
  definitionId?: string;
  executionId?: string;
  derivedIds?: string[];
  occurrenceId?: string;
  observationCount?: number;
  epistemicClasses?: string[];
  reviewState?: DerivedReviewState;
  providerStatus?: ProviderStatus;
  persistenceStatus?: PersistenceStatus;
  outcome?: ExecutionOccurrenceOutcome;
  providerFailureClass?: ProviderFailureClass;
  resolvedNodeCount?: number;
  error?: string;
}

/** In-memory resolved source node. Never persisted. */
export interface ResolvedSourceNode {
  nodeId: string;
  role?: string;
  contentType?: string;
  text: string;
  attachments: Array<{
    id?: string;
    presentInArchive: boolean;
    mimeType?: string;
  }>;
}

export type SourceResolveResult =
  | { ok: true; contentHash: string; nodes: ResolvedSourceNode[] }
  | { ok: false; error: string };

export interface ModelInvokeRequest {
  provider: string;
  model: string;
  prompt: string;
  temperature?: number;
}

export type ModelInvokeResult =
  | {
      ok: true;
      text: string;
      modelVersion?: string;
      providerRequestId?: string;
    }
  | {
      ok: false;
      failureClass: ProviderFailureClass;
    };

// ─── Derived evaluation (E5 human review) ────────────────────────────────────

/**
 * Whether the cited source supports the interpretation as classified.
 * Independent of {@link PersonalRecognition}.
 */
export type EvidenceSupport = 'supported' | 'not-supported' | 'uncertain';

/**
 * The evaluator's present relationship to the interpretation — not an
 * objective truth judgment. Independent of {@link EvidenceSupport}.
 */
export type PersonalRecognition = 'recognized' | 'rejected' | 'uncertain';

/** Who performed the evaluation act. E5 accepts human only. */
export interface EvaluationActor {
  type: 'human';
  name: string;
}

/**
 * Append-only human evaluation of one DerivedRecord.
 *
 * Does not mutate the evaluated record. `evaluatedAt` is the event time
 * of the human judgment and participates in identity. `recordedAt` is
 * when Chronicle persisted that judgment and does not participate in
 * identity. Those timestamps may differ; equality is not required.
 */
export interface DerivedEvaluation {
  schemaVersion: 'derived-evaluation/1';
  id: string;
  evaluatedRecordId: string;
  evaluator: EvaluationActor;
  evaluatedAt: string;
  recordedAt: string;
  evidenceSupport?: EvidenceSupport;
  personalRecognition?: PersonalRecognition;
  noteRef?: string;
  note?: string;
  suppliedRecordId?: string;
  precedingEvaluationId?: string;
}

/** Input to evaluate-derived. Dimensions are optional but at least one. */
export interface EvaluateDerivedInput {
  outputDir: string;
  evaluationsDir: string;
  evaluatedRecordId: string;
  evaluatorName: string;
  evidenceSupport?: EvidenceSupport;
  personalRecognition?: PersonalRecognition;
  note?: string;
  suppliedRecordId?: string;
  precedingEvaluationId?: string;
  evaluatedAt?: string;
  recordedAt?: string;
  dryRun?: boolean;
}

export type EvaluateDerivedStatus =
  | 'recorded'
  | 'already-present'
  | 'dry-run'
  | 'invalid'
  | 'not-found';

/**
 * Result of evaluate-derived. Never includes evaluation note prose —
 * that may be private derived material.
 */
export interface EvaluateDerivedResult {
  status: EvaluateDerivedStatus;
  id?: string;
  path?: string;
  evaluatedRecordId?: string;
  evaluatedAt?: string;
  evidenceSupport?: EvidenceSupport;
  personalRecognition?: PersonalRecognition;
  suppliedRecordId?: string;
  error?: string;
}

/**
 * Provenance query. Exactly one of derived / execution / source /
 * definition / compare is set by the CLI.
 */
export interface ProvenanceQuery {
  executionsDir: string;
  definitionsDir?: string;
  outputDir?: string;
  derivedId?: string;
  executionId?: string;
  definitionId?: string;
  sourceGraphHash?: string;
  compareId?: string;
  withId?: string;
}

export interface ProvenanceDifference {
  field: string;
  a: unknown;
  b: unknown;
}

export type ProvenanceStatus = 'ok' | 'not-found' | 'invalid';

/** Backward, forward, or compare walk over execution history. */
export interface ProvenanceResult {
  status: ProvenanceStatus;
  derivedId?: string;
  executionId?: string;
  definitionId?: string;
  sourceRefs?: DerivedSourceRef[];
  executionIds?: string[];
  derivedIds?: string[];
  execution?: TransformationExecution;
  definition?: TransformationDefinition;
  difference?: ProvenanceDifference[];
  error?: string;
}

// ─── Provenance graph traversal (PRD-0027) ───────────────────────────────────

/**
 * Artifact kinds the provenance graph can name. Closed union for this
 * phase — extend here when a new durable record type joins the path.
 */
export type ProvenanceNodeKind =
  | 'source-archive'
  | 'source-conversation'
  | 'source-node'
  | 'transformation-definition'
  | 'transformation-execution'
  | 'derived-record'
  | 'evaluation';

/**
 * Canonical directed edge types. An execution *cites* a definition and
 * source material; it *produces* derived records. A source graph
 * *contains* conversations and nodes. Direct derived records *cite*
 * source material without an execution. An evaluation *evaluates* a
 * derived record and may *cite* a supplied correction record.
 */
export type ProvenanceEdgeType =
  | 'contains'
  | 'cites'
  | 'produces'
  | 'evaluates';

export type ProvenanceDirection = 'backward' | 'forward';

export type ProvenanceTraverseStatus =
  | 'ok'
  | 'partial'
  | 'not-found'
  | 'invalid';

/** Handle for one artifact. Does not copy domain state. */
export interface ProvenanceRef {
  kind: ProvenanceNodeKind;
  id: string;
}

/** Graph node. `resolved` is false when a cited id could not be loaded. */
export interface ProvenanceNode extends ProvenanceRef {
  resolved: boolean;
}

export interface ProvenanceEdge {
  type: ProvenanceEdgeType;
  from: ProvenanceRef;
  to: ProvenanceRef;
}

/** One simple walk from the start in the requested direction. */
export interface ProvenancePath {
  nodes: ProvenanceRef[];
}

export interface ProvenanceFailure {
  code: string;
  ref: ProvenanceRef;
  citedBy?: ProvenanceRef;
}

/** Input to the first-class provenance traversal handler. */
export interface ProvenanceTraverseInput {
  start: ProvenanceRef;
  direction: ProvenanceDirection;
  graphsDir: string;
  outputDir: string;
  executionsDir: string;
  definitionsDir: string;
  /** Optional. Required when `--from evaluation:` is used. */
  evaluationsDir?: string;
}

/** Structured subgraph plus ordered paths and explicit integrity holes. */
export interface ProvenanceTraverseResult {
  status: ProvenanceTraverseStatus;
  start: ProvenanceRef;
  direction: ProvenanceDirection;
  nodes: ProvenanceNode[];
  edges: ProvenanceEdge[];
  paths: ProvenancePath[];
  failures: ProvenanceFailure[];
  error?: string;
}

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
