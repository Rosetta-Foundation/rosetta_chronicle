import { TransformationExecution } from '../types';
import { sha256Hex } from '../utils/chatgpt-export.utils';
import {
  buildTransformationExecution,
  diffExecutions,
  transformationExecutionId,
  validateTransformationDraft,
} from '../utils/transformation.utils';

const HASH = 'a'.repeat(64);
const CONTENT = 'SYNTHETIC_DERIVED_NOTE';

const refs = [
  { sourceGraphHash: HASH, conversationId: 'conv-1', nodeIds: ['n1'] },
];
const producer = { type: 'human' as const, name: 'fixture' };

const execution = (
  overrides: Partial<TransformationExecution> = {},
): TransformationExecution =>
  buildTransformationExecution({
    transformationType: 'human-note',
    transformationVersion: '1',
    sourceRefs: refs,
    producer,
    createdAt: '2026-08-17T21:00:00.000Z',
    configuration: {},
    deterministic: true,
    outputRefs: ['d'.repeat(64)],
    outputContentRefs: [sha256Hex(CONTENT)],
    ...overrides,
  });

describe('transformation.utils', () => {
  it('builds an execution whose id ignores createdAt', () => {
    const a = execution({ createdAt: '2026-08-17T21:00:00.000Z' });
    const b = execution({ createdAt: '2026-08-18T00:00:00.000Z' });
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(
      transformationExecutionId({
        transformationType: 'human-note',
        transformationVersion: '1',
        sourceRefs: refs,
        producer,
        configuration: {},
        outputContentRefs: [sha256Hex(CONTENT)],
      }),
    );
    expect(a.transformationVersion).toBe('1');
  });

  it('changes identity when content or configuration changes', () => {
    const base = execution();
    const otherContent = execution({
      outputContentRefs: [sha256Hex('SYNTHETIC_OTHER_NOTE')],
    });
    const otherConfig = execution({
      configuration: { tone: 'brief' },
    });
    expect(otherContent.id).not.toBe(base.id);
    expect(otherConfig.id).not.toBe(base.id);
  });

  it('rejects a non-numeric recipe version', () => {
    expect(
      validateTransformationDraft({
        sourceGraphHash: HASH,
        transformationVersion: 'derived-record/1',
      }),
    ).toContain('unknown-transformation-version:derived-record/1');
  });

  it('diffs the fields that would make a re-run different', () => {
    const left = execution();
    const right = execution({
      configuration: { tone: 'brief' },
      outputContentRefs: [sha256Hex('SYNTHETIC_OTHER_NOTE')],
    });
    const fields = diffExecutions(left, right).map((row) => row.field);
    expect(fields).toEqual(['configuration', 'outputContentRefs']);
    expect(diffExecutions(left, left)).toEqual([]);
  });
});
