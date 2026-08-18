import { inject, injectable } from 'inversify';
import { CHRONICLE_TOKENS } from '../tokens';
import {
  DerivedEvaluation,
  EvaluateDerivedInput,
  EvaluateDerivedResult,
} from '../types';
import type { IDerivedRecordStore } from '../repositories/derived-record-store.repository';
import type { IEvaluationStore } from '../repositories/evaluation-store.repository';
import {
  buildDerivedEvaluation,
  validateEvaluationDraft,
} from '../utils/evaluation.utils';

/**
 * Orchestrates append-only human evaluation of a derived record.
 *
 * Resolves the evaluated record (and optional supplied / preceding
 * refs) at write time. Does not mutate the evaluated DerivedRecord,
 * emit Activity, write Daily Chronicles, or invoke a model.
 */
export interface IEvaluationService {
  evaluate(input: EvaluateDerivedInput): Promise<EvaluateDerivedResult>;
}

/**
 * Evaluation implementation of {@link IEvaluationService}.
 *
 * A missing cited derived or preceding evaluation is an input error:
 * nothing is written. A later hole in a valid relationship is a
 * provenance concern, not this write path.
 */
@injectable()
export class EvaluationService implements IEvaluationService {
  constructor(
    @inject(CHRONICLE_TOKENS.DerivedRecordStore)
    private readonly _recordStore: IDerivedRecordStore,
    @inject(CHRONICLE_TOKENS.EvaluationStore)
    private readonly _evaluationStore: IEvaluationStore,
  ) {}

  /** @inheritDoc */
  async evaluate(input: EvaluateDerivedInput): Promise<EvaluateDerivedResult> {
    const draftErrors = validateEvaluationDraft(input);
    if (draftErrors.length > 0) {
      return this.invalid(draftErrors.join(', '));
    }

    const evaluated = await this._recordStore.read(
      input.outputDir,
      input.evaluatedRecordId,
    );
    if (!evaluated) {
      const diagnosis = await this._recordStore.diagnose(
        input.outputDir,
        input.evaluatedRecordId,
      );
      return {
        status: 'not-found',
        error:
          diagnosis === 'invalid'
            ? 'evaluated-record-invalid'
            : 'evaluated-record-missing',
      };
    }

    if (input.suppliedRecordId) {
      const supplied = await this._recordStore.read(
        input.outputDir,
        input.suppliedRecordId,
      );
      if (!supplied) {
        const diagnosis = await this._recordStore.diagnose(
          input.outputDir,
          input.suppliedRecordId,
        );
        return {
          status: 'not-found',
          error:
            diagnosis === 'invalid'
              ? 'supplied-record-invalid'
              : 'supplied-record-missing',
        };
      }
    }

    if (input.precedingEvaluationId) {
      const preceding = await this._evaluationStore.read(
        input.evaluationsDir,
        input.precedingEvaluationId,
      );
      if (!preceding) {
        const diagnosis = await this._evaluationStore.diagnose(
          input.evaluationsDir,
          input.precedingEvaluationId,
        );
        return {
          status: 'not-found',
          error:
            diagnosis === 'invalid'
              ? 'preceding-evaluation-invalid'
              : 'preceding-evaluation-missing',
        };
      }
    }

    const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
    const recordedAt = input.recordedAt ?? new Date().toISOString();
    const evaluation = buildDerivedEvaluation({
      evaluatedRecordId: input.evaluatedRecordId,
      evaluator: { type: 'human', name: input.evaluatorName.trim() },
      evaluatedAt,
      recordedAt,
      evidenceSupport: input.evidenceSupport,
      personalRecognition: input.personalRecognition,
      note: input.note,
      suppliedRecordId: input.suppliedRecordId,
      precedingEvaluationId: input.precedingEvaluationId,
    });

    const existing = await this._evaluationStore.read(
      input.evaluationsDir,
      evaluation.id,
    );
    if (existing && existing.id === evaluation.id) {
      return this.toResult('already-present', existing, input.evaluationsDir);
    }
    if (input.dryRun) {
      return this.toResult('dry-run', evaluation, input.evaluationsDir);
    }
    await this._evaluationStore.write(input.evaluationsDir, evaluation);
    return this.toResult('recorded', evaluation, input.evaluationsDir);
  }

  private invalid(error: string): EvaluateDerivedResult {
    return { status: 'invalid', error };
  }

  private toResult(
    status: 'recorded' | 'already-present' | 'dry-run',
    evaluation: DerivedEvaluation,
    evaluationsDir: string,
  ): EvaluateDerivedResult {
    return {
      status,
      id: evaluation.id,
      path: this._evaluationStore.pathFor(evaluationsDir, evaluation.id),
      evaluatedRecordId: evaluation.evaluatedRecordId,
      evaluatedAt: evaluation.evaluatedAt,
      ...(evaluation.evidenceSupport
        ? { evidenceSupport: evaluation.evidenceSupport }
        : {}),
      ...(evaluation.personalRecognition
        ? { personalRecognition: evaluation.personalRecognition }
        : {}),
      ...(evaluation.suppliedRecordId
        ? { suppliedRecordId: evaluation.suppliedRecordId }
        : {}),
    };
  }
}
