import {
  DerivedProducer,
  DerivedSourceRef,
  ExecutionOccurrence,
  ExecutionOccurrenceOutcome,
  PersistenceStatus,
  ProviderFailureClass,
  ProviderStatus,
} from '../types';
import { sha256Hex } from './chatgpt-export.utils';
import { CONTENT_HASH } from './derived-record.utils';
import { stableObject } from './transformation.utils';

/**
 * Occurrence identity includes startedAt and nonce so retries never
 * collapse. Output hashes are not part of this id.
 */
export const executionOccurrenceId = (input: {
  definitionId: string;
  sourceRefs: DerivedSourceRef[];
  producer: DerivedProducer;
  configuration: Record<string, unknown>;
  startedAt: string;
  nonce: string;
}): string =>
  sha256Hex(
    JSON.stringify({
      definitionId: input.definitionId,
      sourceRefs: input.sourceRefs,
      producer: input.producer,
      configuration: stableObject(input.configuration),
      startedAt: input.startedAt,
      nonce: input.nonce,
    }),
  );

export const buildExecutionOccurrence = (input: {
  definitionId: string;
  sourceRefs: DerivedSourceRef[];
  producer: DerivedProducer;
  configuration: Record<string, unknown>;
  startedAt: string;
  endedAt: string;
  nonce: string;
  providerStatus: ProviderStatus;
  persistenceStatus: PersistenceStatus;
  outcome?: ExecutionOccurrenceOutcome;
  providerFailureClass?: ProviderFailureClass;
  persistenceFailureClass?: 'persist-failed';
  executionId?: string;
  derivedIds?: string[];
  providerRequestId?: string;
  modelVersion?: string;
}): ExecutionOccurrence => ({
  id: executionOccurrenceId({
    definitionId: input.definitionId,
    sourceRefs: input.sourceRefs,
    producer: input.producer,
    configuration: input.configuration,
    startedAt: input.startedAt,
    nonce: input.nonce,
  }),
  definitionId: input.definitionId,
  sourceRefs: input.sourceRefs,
  producer: input.producer,
  configuration: stableObject(input.configuration),
  startedAt: input.startedAt,
  endedAt: input.endedAt,
  nonce: input.nonce,
  providerStatus: input.providerStatus,
  persistenceStatus: input.persistenceStatus,
  ...(input.outcome ? { outcome: input.outcome } : {}),
  ...(input.providerFailureClass
    ? { providerFailureClass: input.providerFailureClass }
    : {}),
  ...(input.persistenceFailureClass
    ? { persistenceFailureClass: input.persistenceFailureClass }
    : {}),
  ...(input.executionId ? { executionId: input.executionId } : {}),
  ...(input.derivedIds ? { derivedIds: input.derivedIds } : {}),
  ...(input.providerRequestId
    ? { providerRequestId: input.providerRequestId }
    : {}),
  ...(input.modelVersion ? { modelVersion: input.modelVersion } : {}),
});

export const validateOccurrenceId = (id: string): boolean =>
  CONTENT_HASH.test(id);
