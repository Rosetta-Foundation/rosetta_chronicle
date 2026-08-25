import { injectable, inject } from 'inversify';
import { CHRONICLE_TOKENS } from './tokens';
import {
  DailyChronicle,
  DailyChronicleInput,
  PersistedChronicle,
} from './types';
import { parseExistingNotes } from './utils/chronicle-parse.utils';
import { checkClobber, ClobberCheck } from './utils/clobber.utils';
import type { IChronicleService } from './services/chronicle.service';
import type { IChronicleRepository } from './repositories/chronicle.repository';
import type { INotesStore } from './repositories/notes-store.repository';
import type { IChronicleStore } from './repositories/chronicle-store.repository';

/** The result of a Daily Chronicle run: the generated doc and, if persisted, where it landed. */
export interface DailyChronicleResult {
  chronicle: DailyChronicle;
  persisted?: PersistedChronicle;
  /**
   * Set when the clobber guard (PRD-0005) blocked persistence because the fresh
   * run's activity was a strict subset of a prior run's. Lists what would have
   * been dropped. When set, `persisted` is absent.
   */
  clobberPrevented?: ClobberCheck;
  /**
   * True when `skipEmpty` suppressed persistence because the day had no
   * activity and no prior Chronicle. When set, `persisted` is absent.
   */
  skippedEmpty?: boolean;
}

/**
 * Entry point for generating a v0.1 Daily Chronicle. **Deprecated / frozen**
 * with that MVP — not the capture path for new work. Parses the request,
 * dispatches to the service, optionally persists the result, and returns
 * it. Composition (migrate notes → capture notes → generate → persist)
 * happens here, not in a service. No business logic.
 */
export interface IDailyChronicleHandler {
  handle(input: DailyChronicleInput): Promise<DailyChronicleResult>;
}

/**
 * Root handler implementation of {@link IDailyChronicleHandler}.
 *
 * Wires the full flow for a day: (1) one-time migrate notes out of any
 * previously rendered Chronicle into the authoritative notes file (so
 * pre-PRD-0003 days are not lost); (2) append any inline notes from this run to
 * that file (live capture); (3) read prior tags from the structured sidecar
 * (source of truth) and the authoritative notes, and hand them to
 * {@link IChronicleService} for synthesis; (4) guard against a clobbering
 * regeneration (PRD-0005) — refuse to overwrite when this run's activity is a
 * strict subset of the prior sidecar's, unless `force`; (5) persist both the
 * rendered document via {@link IChronicleRepository} and the structured sidecar
 * via {@link IChronicleStore} when an output repo is given. Notes are
 * authoritative input and the sidecar is the regeneration source of truth —
 * neither is recovered by re-parsing rendered Markdown. This composition is a
 * handler concern by design; the handler holds no business logic of its own.
 */
@injectable()
export class DailyChronicleHandler implements IDailyChronicleHandler {
  constructor(
    @inject(CHRONICLE_TOKENS.ChronicleService)
    private readonly _chronicleService: IChronicleService,
    @inject(CHRONICLE_TOKENS.ChronicleRepository)
    private readonly _chronicleRepo: IChronicleRepository,
    @inject(CHRONICLE_TOKENS.NotesStore)
    private readonly _notesStore: INotesStore,
    @inject(CHRONICLE_TOKENS.ChronicleStore)
    private readonly _chronicleStore: IChronicleStore,
  ) {}

  /** @inheritDoc */
  async handle(input: DailyChronicleInput): Promise<DailyChronicleResult> {
    const date = input.window.start;

    // Read prior state before regenerating. The structured sidecar is the source
    // of truth for carried-over tags; the rendered Markdown is only a migration
    // fallback for legacy days that predate the sidecar.
    const [priorData, existingMarkdown] = input.outputRepoPath
      ? await Promise.all([
          this._chronicleStore.readDaily(input.outputRepoPath, date),
          this._chronicleRepo.readDaily(input.outputRepoPath, date),
        ])
      : [null, null];

    // Notes are authoritative input (PRD-0003). When persisting, resolve the
    // day's notes from the human-owned notes file rather than re-parsing the
    // rendered Chronicle. One-time migrate any notes that only exist in an older
    // rendered Chronicle, then fold in this run's inline notes.
    const notes = input.outputRepoPath
      ? await this._resolveNotes(
          input.outputRepoPath,
          date,
          existingMarkdown,
          input.notes,
        )
      : input.notes;

    const chronicle = await this._chronicleService.generateDailyChronicle({
      ...input,
      notes,
      priorTags: priorData?.tags,
      existingMarkdown: existingMarkdown ?? undefined,
    });

    if (!input.outputRepoPath) {
      return { chronicle };
    }

    // Quiet-day suppression: range operations (backfill, sweep) must not
    // commit empty documents for weekends or vacations. A day that already
    // has a Chronicle still regenerates normally.
    if (
      input.skipEmpty &&
      chronicle.data.activities.length === 0 &&
      !priorData &&
      !existingMarkdown
    ) {
      return { chronicle, skippedEmpty: true };
    }

    // Clobber guard (PRD-0005): if a prior sidecar exists and this run would drop
    // activity it captured — with nothing new to offset the loss — refuse to
    // overwrite unless forced. Protects derived git/session activity the way
    // PRD-0003 protects notes. Compares against the sidecar (source of truth).
    if (priorData && !input.force) {
      const clobber = checkClobber(
        chronicle.data.activities,
        priorData.activities,
      );
      if (clobber.wouldClobber) {
        return { chronicle, clobberPrevented: clobber };
      }
    }

    // Persist the structured sidecar (source of truth) before the render, so a
    // failure mid-persist never leaves rendered Markdown without its data.
    await this._chronicleStore.writeDaily(input.outputRepoPath, chronicle.data);
    const persisted = await this._chronicleRepo.persistDaily(
      input.outputRepoPath,
      chronicle,
    );
    return { chronicle, persisted };
  }

  /**
   * Resolve the authoritative notes text for a day. Migrates notes found only in
   * an older rendered Chronicle into the notes file (once), appends this run's
   * inline notes, then returns the file's contents as the source of truth.
   * Appends are content-hash deduplicated by the store, so this is idempotent.
   */
  private async _resolveNotes(
    repoPath: string,
    date: string,
    existingMarkdown: string | null,
    inlineNotes?: string,
  ): Promise<string | undefined> {
    // One-time migration: lift notes out of a previously rendered Chronicle.
    if (existingMarkdown) {
      const priorNotes = parseExistingNotes(existingMarkdown);
      if (priorNotes.length > 0) {
        await this._notesStore.appendDaily(
          repoPath,
          date,
          priorNotes.join('\n'),
        );
      }
    }

    // Live capture: fold this run's inline notes into the authoritative file.
    if (inlineNotes && inlineNotes.trim().length > 0) {
      await this._notesStore.appendDaily(repoPath, date, inlineNotes);
    }

    const stored = await this._notesStore.readDaily(repoPath, date);
    return stored ?? inlineNotes;
  }
}
