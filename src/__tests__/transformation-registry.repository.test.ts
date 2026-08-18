import { TransformationRegistry } from '../repositories/transformation-registry.repository';

describe('TransformationRegistry', () => {
  it('resolves registered recipes and rejects unknown versions', () => {
    const registry = new TransformationRegistry();
    const note = registry.get('human-note', '1');
    expect(note).toEqual({
      type: 'human-note',
      version: '1',
      description: 'Caller-supplied note citing source-graph structure.',
      deterministic: true,
      allowedProducerTypes: ['human', 'agent'],
    });
    expect(registry.get('human-note', '9')).toBeNull();
    expect(registry.get('llm-reflection', '1')).toBeNull();
    expect(registry.list().map((row) => row.type)).toContain('revision');
  });
});
