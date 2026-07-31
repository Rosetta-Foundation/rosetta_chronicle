/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  coverageProvider: 'v8',
  // src/bin/cli.ts is excluded from the coverage metric, not from testing: the
  // CLI is exercised end-to-end in cli.test.ts via child_process against the
  // built artifact, which V8 in-process coverage cannot attribute.
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts', '!src/bin/**'],
};
