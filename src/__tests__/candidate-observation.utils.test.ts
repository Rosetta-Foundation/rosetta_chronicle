import { parseCandidateObservationOutput } from '../utils/candidate-observation.utils';

const NODES = ['node-linear-1', 'node-linear-2'];

describe('parseCandidateObservationOutput', () => {
  it('splits a bundle into one payload per observation', () => {
    const parsed = parseCandidateObservationOutput(
      JSON.stringify({
        result: 'observations',
        observations: [
          {
            statement: 'SYNTHETIC_DIRECT',
            epistemicClass: 'directly-supported',
            citedNodeIds: ['node-linear-1'],
          },
          {
            statement: 'SYNTHETIC_INFERRED',
            epistemicClass: 'inferred',
            citedNodeIds: ['node-linear-2'],
          },
        ],
      }),
      NODES,
    );
    expect(parsed).toEqual({
      payloads: [
        expect.objectContaining({
          result: 'observation',
          epistemicClass: 'directly-supported',
        }),
        expect.objectContaining({
          result: 'observation',
          epistemicClass: 'inferred',
        }),
      ],
    });
  });

  it('accepts insufficient-evidence as a single payload', () => {
    const parsed = parseCandidateObservationOutput(
      JSON.stringify({
        result: 'insufficient-evidence',
        citedNodeIds: ['node-linear-1'],
        supportNote: 'SYNTHETIC_DECLINE',
      }),
      NODES,
    );
    expect(parsed).toEqual({
      payloads: [
        expect.objectContaining({
          result: 'insufficient-evidence',
          citedNodeIds: ['node-linear-1'],
        }),
      ],
    });
  });

  it('rejects unknown cited nodes and extra observations', () => {
    expect(
      parseCandidateObservationOutput(
        JSON.stringify({
          result: 'observations',
          observations: [
            {
              statement: 'x',
              epistemicClass: 'directly-supported',
              citedNodeIds: ['invented'],
            },
          ],
        }),
        NODES,
      ),
    ).toEqual({ error: 'invalid-output:cited-node-unknown' });
    expect(
      parseCandidateObservationOutput('not-json', NODES),
    ).toEqual({ error: 'invalid-output:not-json' });
    expect(
      parseCandidateObservationOutput(
        JSON.stringify({
          result: 'observations',
          observations: [1, 2, 3, 4].map((n) => ({
            statement: `s${n}`,
            epistemicClass: 'inferred',
            citedNodeIds: ['node-linear-1'],
          })),
        }),
        NODES,
      ),
    ).toEqual({ error: 'invalid-output:too-many-observations' });
  });

  it('sorts citedNodeIds so citation order is not identity', () => {
    const parsed = parseCandidateObservationOutput(
      JSON.stringify({
        result: 'observations',
        observations: [
          {
            statement: 'SYNTHETIC_DIRECT',
            epistemicClass: 'directly-supported',
            citedNodeIds: ['node-linear-2', 'node-linear-1'],
          },
        ],
      }),
      NODES,
    );
    expect(parsed).toEqual({
      payloads: [
        expect.objectContaining({
          citedNodeIds: ['node-linear-1', 'node-linear-2'],
        }),
      ],
    });
  });
});
