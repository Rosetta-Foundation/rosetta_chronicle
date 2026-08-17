import 'reflect-metadata';
import {
  buildContainer,
  getChatGptInventoryHandler,
  getDailyChronicleHandler,
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
