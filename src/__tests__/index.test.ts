import 'reflect-metadata';
import {
  buildContainer,
  getChatGptImportHandler,
  getChatGptInventoryHandler,
  getDailyChronicleHandler,
  getDerivedRecordHandler,
  getTransformationHandler,
  getProvenanceHandler,
  getInterpretHandler,
  getEvaluateHandler,
} from '../index';
import { CHRONICLE_TOKENS } from '../tokens';

/**
 * Composition-root tests: every token must resolve from a fresh container.
 * Catches missing/mistyped DI bindings that unit tests (which build their own
 * containers) would never see.
 */
describe('buildContainer', () => {
  it('resolves every registered token', () => {
    const container = buildContainer();
    for (const [name, token] of Object.entries(CHRONICLE_TOKENS)) {
      expect(container.get(token)).toBeDefined();
      expect(container.get(token)).not.toBeNull();
      // Name is only used in the assertion message on failure.
      void name;
    }
  });

  it('returns a fresh container per call', () => {
    const a = buildContainer();
    const b = buildContainer();
    expect(a).not.toBe(b);
  });
});

describe('getDailyChronicleHandler', () => {
  it('resolves the root handler with its full dependency graph', () => {
    const handler = getDailyChronicleHandler();
    expect(handler).toBeDefined();
    expect(typeof handler.handle).toBe('function');
  });
});

describe('getChatGptInventoryHandler', () => {
  it('resolves the inventory handler with its dependency graph', () => {
    const handler = getChatGptInventoryHandler();
    expect(handler).toBeDefined();
    expect(typeof handler.handle).toBe('function');
  });
});

describe('getChatGptImportHandler', () => {
  it('resolves the import handler with its dependency graph', () => {
    const handler = getChatGptImportHandler();
    expect(handler).toBeDefined();
    expect(typeof handler.handle).toBe('function');
  });
});

describe('getDerivedRecordHandler', () => {
  it('resolves the derived-record handler with its dependency graph', () => {
    const handler = getDerivedRecordHandler();
    expect(handler).toBeDefined();
    expect(typeof handler.handle).toBe('function');
  });
});

describe('getTransformationHandler', () => {
  it('resolves the transformation handler with its dependency graph', () => {
    const handler = getTransformationHandler();
    expect(handler).toBeDefined();
    expect(typeof handler.handle).toBe('function');
    expect(typeof handler.provenance).toBe('function');
  });
});

describe('getProvenanceHandler', () => {
  it('resolves the provenance handler with its dependency graph', () => {
    const handler = getProvenanceHandler();
    expect(handler).toBeDefined();
    expect(typeof handler.handle).toBe('function');
  });
});

describe('getInterpretHandler', () => {
  it('resolves the interpret handler with its dependency graph', () => {
    const handler = getInterpretHandler();
    expect(handler).toBeDefined();
    expect(typeof handler.handle).toBe('function');
  });
});

describe('getEvaluateHandler', () => {
  it('resolves the evaluate handler with its dependency graph', () => {
    const handler = getEvaluateHandler();
    expect(handler).toBeDefined();
    expect(typeof handler.handle).toBe('function');
  });
});
