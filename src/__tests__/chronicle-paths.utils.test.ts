import { join } from 'path';
import {
  defaultChronicleDataDir,
  resolveChronicleDataDir,
  resolveChronicleGraphsDir,
} from '../utils/chronicle-paths.utils';

const HOME = '/tmp/chronicle-home-fixture';

describe('chronicle data-dir resolution', () => {
  it('defaults under ~/.local/share/rosetta/chronicle/default', () => {
    expect(defaultChronicleDataDir(HOME)).toBe(
      join(HOME, '.local', 'share', 'rosetta', 'chronicle', 'default'),
    );
  });

  it('prefers an explicit --data-dir over env and default', () => {
    expect(
      resolveChronicleDataDir('/explicit', { CHRONICLE_DATA_DIR: '/from-env' }, HOME),
    ).toBe('/explicit');
  });

  it('uses CHRONICLE_DATA_DIR when no flag is given', () => {
    expect(
      resolveChronicleDataDir(undefined, { CHRONICLE_DATA_DIR: '/from-env' }, HOME),
    ).toBe('/from-env');
  });

  it('falls back to the product default', () => {
    expect(resolveChronicleDataDir(undefined, {}, HOME)).toBe(
      defaultChronicleDataDir(HOME),
    );
  });

  it('defaults graphs to <data-dir>/graphs', () => {
    expect(resolveChronicleGraphsDir(undefined, {}, HOME)).toBe(
      join(defaultChronicleDataDir(HOME), 'graphs'),
    );
  });

  it('prefers CHRONICLE_SOURCE_GRAPH_DIR over the data-dir graphs folder', () => {
    expect(
      resolveChronicleGraphsDir(undefined, { CHRONICLE_SOURCE_GRAPH_DIR: '/g' }, HOME),
    ).toBe('/g');
  });
});
