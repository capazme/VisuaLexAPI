import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Route every `import nock from 'nock'` in the tests to our fetch-based shim.
  // nock 14 intercepts HTTP via @mswjs/interceptors (patches http.ClientRequest),
  // which intermittently corrupts the supertest→app sockets (HTTP parse errors,
  // crossed responses). The MERL-T clients use native fetch and supertest uses
  // http, so tests/nockShim.ts mocks only global.fetch and never touches
  // supertest's transport — eliminating that flake at the root.
  resolve: {
    alias: [
      {
        find: /^nock$/,
        replacement: fileURLToPath(new URL('./tests/nockShim.ts', import.meta.url)),
      },
    ],
  },
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
