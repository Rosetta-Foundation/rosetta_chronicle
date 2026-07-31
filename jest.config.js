/** @type {import('jest').Config} */
module.exports = {
  // @swc/jest transpiles only (no per-file type-check); type-checking is the
  // build's job (`tsc`, TypeScript 7 native). legacyDecorator+decoratorMetadata
  // mirror the tsconfig flags InversifyJS requires.
  transform: {
    '^.+\\.ts$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
          target: 'es2022',
        },
        module: { type: 'commonjs' },
      },
    ],
  },
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  coverageProvider: 'v8',
  // src/bin/cli.ts is excluded from the coverage metric, not from testing: the
  // CLI is exercised end-to-end in cli.test.ts via child_process against the
  // built artifact, which V8 in-process coverage cannot attribute.
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts', '!src/bin/**'],
};
