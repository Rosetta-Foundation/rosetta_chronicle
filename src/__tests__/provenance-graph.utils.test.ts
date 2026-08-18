import {
  buildProvenanceEdges,
  collectPaths,
  parseProvenanceFrom,
  walkNeighbors,
} from '../utils/provenance-graph.utils';

const HASH = 'a'.repeat(64);

describe('provenance-graph.utils', () => {
  it('parses --from kinds and rejects a bad id', () => {
    expect(parseProvenanceFrom(`derived-record:${HASH}`).ref).toEqual({
      kind: 'derived-record',
      id: HASH,
    });
    expect(
      parseProvenanceFrom(`source-node:${HASH}:conv-1:n1`).ref,
    ).toEqual({
      kind: 'source-node',
      id: `${HASH}:conv-1:n1`,
    });
    expect(parseProvenanceFrom(`execution:${HASH}`).ref).toEqual({
      kind: 'transformation-execution',
      id: HASH,
    });
    expect(parseProvenanceFrom(`definition:${HASH}`).ref).toEqual({
      kind: 'transformation-definition',
      id: HASH,
    });
    expect(parseProvenanceFrom(`evaluation:${HASH}`).ref).toEqual({
      kind: 'evaluation',
      id: HASH,
    });
    expect(parseProvenanceFrom('derived-record:nope').error).toBe(
      'from-id-invalid',
    );
  });

  it('walks cites inversely on forward and outward on backward', () => {
    const execution = {
      kind: 'transformation-execution' as const,
      id: 'e'.repeat(64),
    };
    const archive = { kind: 'source-archive' as const, id: HASH };
    const edges = [
      { type: 'cites' as const, from: execution, to: archive },
    ];
    expect(walkNeighbors(archive, 'forward', edges)).toEqual([execution]);
    expect(walkNeighbors(execution, 'backward', edges)).toEqual([archive]);
    expect(walkNeighbors(archive, 'backward', edges)).toEqual([]);
    expect(walkNeighbors(execution, 'forward', edges)).toEqual([]);
  });

  it('walks evaluates inversely on forward and outward on backward', () => {
    const evaluation = { kind: 'evaluation' as const, id: 'e'.repeat(64) };
    const derived = { kind: 'derived-record' as const, id: 'c'.repeat(64) };
    const edges = [
      { type: 'evaluates' as const, from: evaluation, to: derived },
    ];
    expect(walkNeighbors(derived, 'forward', edges)).toEqual([evaluation]);
    expect(walkNeighbors(evaluation, 'backward', edges)).toEqual([derived]);
    expect(walkNeighbors(derived, 'backward', edges)).toEqual([]);
    expect(walkNeighbors(evaluation, 'forward', edges)).toEqual([]);
  });

  it('suppresses duplicate edges and records a cycle without looping', () => {
    const a = { kind: 'derived-record' as const, id: 'c'.repeat(64) };
    const b = {
      kind: 'transformation-execution' as const,
      id: 'd'.repeat(64),
    };
    const edges = buildProvenanceEdges({
      executions: [],
      derived: [],
      graphs: new Map(),
    });
    expect(edges).toEqual([]);
    const cyclic = [
      { type: 'produces' as const, from: b, to: a },
      { type: 'produces' as const, from: a, to: b },
    ];
    const failures: { code: string; ref: typeof a }[] = [];
    const paths = collectPaths(a, 'forward', cyclic, failures);
    expect(paths.length).toBeGreaterThan(0);
    expect(failures.some((row) => row.code === 'cycle')).toBe(true);
  });
});
