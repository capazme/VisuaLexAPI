import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    forks: {
      singleFork: true, // single process
    },
    fileParallelism: false, // run test files sequentially so the shared test DB is fully isolated by beforeEach TRUNCATE
  },
});
