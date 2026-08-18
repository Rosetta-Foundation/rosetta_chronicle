import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import {
  DerivedRecord,
  DerivedRecordInput,
  DerivedRecordResult,
} from '../types';
import type { IChatGptGraphStore } from '../repositories/chatgpt-graph-store.repository';
import type { IDerivedRecordStore } from '../repositories/derived-record-store.repository';
import {
  buildDerivedRecord,
  defaultReviewState,
  validateDerivedDraft,
  validateSourceRefsOnGraph,
} from '../utils/derived-record.utils';

/**
 * Orchestrates provenance-preserving derived-record persistence.
 *
 * Builds a transformation record from declared source-graph refs and
 * human (or later agent) content. Does not summarize, emit Activity, or
 * write Daily Chronicles. Output directory is caller configuration.
 */
export interface IDerivedRecordService {
  record(input: DerivedRecordInput): Promise<DerivedRecordResult>;
}

/**
 * Derived-record implementation of {@link IDerivedRecordService}.
 *
 * Validates producer/content/refs, optionally checks them against a
 * loaded source graph, then persists keyed by a stable id. Re-record of
 * the same stable fields is a no-op and keeps the original `createdAt`.
 */
@injectable()
export class DerivedRecordService implements IDerivedRecordService {
  constructor(
    @inject(CHRONICLE_TOKENS.DerivedRecordStore)
    private readonly _recordStore: IDerivedRecordStore,
    @inject(CHRONICLE_TOKENS.ChatGptGraphStore)
    private readonly _graphStore: IChatGptGraphStore,
  ) {}

  /** @inheritDoc */
  async record(input: DerivedRecordInput): Promise<DerivedRecordResult> {
    const draftErrors = validateDerivedDraft({
      sourceGraphHash: input.sourceGraphHash,
      nodeIds: input.nodeIds,
      transformationType: input.transformationType,
      createdBy: input.createdBy,
      content: input.content,
      confidence: input.confidence,
    });
    if (draftErrors.length > 0) {
      return this.invalid(draftErrors.join(', '));
    }

    const sourceRefs = [
      {
        sourceGraphHash: input.sourceGraphHash,
        ...(input.conversationId
          ? { conversationId: input.conversationId }
          : {}),
        nodeIds: [...input.nodeIds],
      },
    ];

    if (input.graphPath) {
      const graph = await this._graphStore.readAt(input.graphPath);
      if (!graph) {
        return this.invalid(`source-graph-unreadable:${input.graphPath}`);
      }
      const refErrors = validateSourceRefsOnGraph(graph, sourceRefs[0]);
      if (refErrors.length > 0) {
        return this.invalid(refErrors.join(', '));
      }
    }

    const reviewState =
      input.reviewState ?? defaultReviewState(input.createdBy.type);
    const record = buildDerivedRecord({
      sourceRefs,
      transformationType: input.transformationType,
      createdBy: input.createdBy,
      content: input.content,
      createdAt: input.createdAt ?? new Date().toISOString(),
      confidence: input.confidence,
      reviewState,
    });

    const existing = await this._recordStore.read(input.outputDir, record.id);
    if (existing && existing.id === record.id) {
      return this.toResult('already-present', existing, input.outputDir);
    }
    if (input.dryRun) {
      return this.toResult('recorded', record, input.outputDir);
    }
    await this._recordStore.write(input.outputDir, record);
    return this.toResult('recorded', record, input.outputDir);
  }

  private invalid(error: string): DerivedRecordResult {
    return { status: 'invalid', error };
  }

  private toResult(
    status: 'recorded' | 'already-present',
    record: DerivedRecord,
    outputDir: string,
  ): DerivedRecordResult {
    return {
      status,
      id: record.id,
      path: this._recordStore.pathFor(outputDir, record.id),
      contentRef: record.contentRef,
      createdAt: record.createdAt,
      reviewState: record.reviewState,
    };
  }
}
