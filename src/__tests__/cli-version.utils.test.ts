import { join } from 'path';
import { readCliVersion } from '../utils/cli-version.utils';

describe('readCliVersion', () => {
  it('reads the engine package version', () => {
    const root = join(__dirname, '../..');
    expect(readCliVersion(root)).toMatch(/^\d+\.\d+\.\d+/);
  });
});
