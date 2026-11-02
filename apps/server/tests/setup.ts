import { beforeAll, beforeEach, inject, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { dropDevelopmentEnv } from './devEnvGuard';
import { SCHEMA_FINGERPRINT, assertTestDatabase, type TestDatabase } from './testDatabase';

// The suite's environment is `.env.test` alone (`tests/devEnvGuard.ts`). `src/config.ts` calls
// `dotenv.config()`, which would read a development `apps/server/.env` into the run: a no-op here.
vi.mock('dotenv', () => {
  const config = () => ({ parsed: {} });
  return { default: { config }, config };
});
// Prisma loads that `.env` itself, at the import and at every construction (the clients of
// `src/lib/prisma.ts` and `tests/helpers.ts` come after this file): whatever it adds goes at once.
vi.mock('@prisma/client', async (importOriginal) => {
  const { dropAddedSince } = await import('./devEnvGuard');
  const before = new Set(Object.keys(process.env));
  const actual = await importOriginal<typeof import('@prisma/client')>();
  dropAddedSince(before);
  class PrismaClient extends actual.PrismaClient {
    constructor(...args: ConstructorParameters<typeof actual.PrismaClient>) {
      const known = new Set(Object.keys(process.env));
      super(...args);
      dropAddedSince(known);
    }
  }
  return { ...actual, PrismaClient };
});

const prisma = new PrismaClient();
// A guarded name exported by the shell, or anywhere else outside `.env.test`.
dropDevelopmentEnv();

// The OAuth endpoints' own rate limits are per address, and the whole suite
// comes from 127.0.0.1: lift them here (the flood test builds its own router
// with a low one), and give the MCP server's credential a test value.
// Assigned, never `??=`: a value from outside must not win over the one the helpers
// send (`tests/oauth/testEnv.test.ts`, and `tests/devEnvGuard.ts` for the rest).
process.env.OAUTH_REGISTRATIONS_PER_HOUR = '100000';
process.env.OAUTH_REQUESTS_PER_15_MINUTES = '100000';
process.env.OAUTH_MCP_CLIENT_SECRET = 'test-mcp-client-secret';
process.env.OAUTH_DELEGATION_SECRET = 'test-delegation-secret';

// The database was reset once for the run (`tests/globalSetup.ts`). Before each test every
// table is emptied, with DELETEs in the order the foreign keys allow (a TRUNCATE costs about
// 200 ms each time, rewriting each table's files, against a few ms), and the text versions the
// migrations insert are put back: every test starts from empty tables plus version 1 of each
// text to accept, as a fresh database has. Each file first checks that the schema is still the
// one the migrations made: no reset runs between files any more.
let database: TestDatabase;

beforeAll(async () => {
  assertTestDatabase();
  database = inject('testDatabase');
  const [schema] = await prisma.$queryRawUnsafe<{ fingerprint: string }[]>(SCHEMA_FINGERPRINT);
  if (schema.fingerprint !== database.schema) {
    throw new Error(
      'The test database schema is no longer the one the migrations made at the start of the run: ' +
        'a test in an earlier file changed it and did not undo it (one that timed out before its `finally`?). ' +
        'Fix that test; the next run resets the database.'
    );
  }
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(database.emptyEveryTable);
  await prisma.$executeRaw`
    INSERT INTO lingo_testi_versioni
    SELECT * FROM json_populate_recordset(NULL::lingo_testi_versioni, ${database.seededTexts}::json)`;
});

export { prisma };
