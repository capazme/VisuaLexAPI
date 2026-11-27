import { beforeAll, beforeEach, inject, vi } from 'vitest';
import { PrismaClient } from '../src/lib/db';
import { createPgAdapter } from '../src/lib/pgAdapter';
import { dropDevelopmentEnv } from './devEnvGuard';
import { SCHEMA_FINGERPRINT, assertTestDatabase, type TestDatabase } from './testDatabase';
import { SCHEMA_ROWS, fullName, localFileFor, localSkips, schemaDigest } from './localRun';

// On the desktop app's encrypted local file (`LEXCRAFT_TEST_DB=local`, `tests/localRun.ts`), the server's one client
// is the app's local client on this file's own copy of the template: built here, since vitest's runner does not load
// TypeScript through the `require` that `src/lib/prisma.ts` uses in local mode (the built server and tsx do).
// Otherwise the module is the real one.
vi.mock('../src/lib/prisma', async (importOriginal) => {
  const local = inject('testDatabase').local;
  if (!local) return importOriginal();
  const { localAdapter } = await import('../src/local/database');
  const { PrismaClient: LocalPrismaClient } = await import('../src/generated/prisma-local/client');
  const file = process.env.LEXCRAFT_DB_FILE ?? '';
  return { prisma: new LocalPrismaClient({ adapter: localAdapter({ file, keyHex: local.keyHex }) }) };
});

// The suite's environment is `.env.test` alone (`tests/devEnvGuard.ts`). `src/config.ts` calls
// `dotenv.config()`, which would read a development `apps/server/.env` into the run: a no-op here.
vi.mock('dotenv', () => {
  const config = () => ({ parsed: {} });
  return { default: { config }, config };
});
// Prisma 7 loads no `.env` of its own (its generated client has no dotenv): `dotenv` above is the only loader.
// The run's own database (`tests/globalSetup.ts`): from here on every reader of DATABASE_URL in this process uses
// it: this file's client, `src/lib/prisma.ts`, `src/config.ts`, `tests/helpers.ts` and the tests themselves.
const localRun = inject('testDatabase').local;
if (localRun) {
  // The local mode, as the desktop app runs it: the dialect seam drops Postgres's locks, no source is reached.
  const file = localFileFor(localRun);
  Object.assign(process.env, { LEXCRAFT_MODE: 'local', LEXCRAFT_DB_FILE: file, DATABASE_URL: `file:${file}` });
} else {
  process.env.DATABASE_URL = inject('testDatabase').url;
}
type Client = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe' | '$executeRaw' | '$transaction'>;
let prisma: Client = localRun
  ? (undefined as unknown as Client) // the app's own, once the mocked module loads (beforeAll)
  : new PrismaClient({ adapter: createPgAdapter(process.env.DATABASE_URL ?? '') });
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

// The run's database was created and migrated once (`tests/globalSetup.ts`). Before each test every
// table is emptied, with DELETEs in the order the foreign keys allow (a TRUNCATE costs about
// 200 ms each time, rewriting each table's files, against a few ms), and the text versions the
// migrations insert are put back: every test starts from empty tables plus version 1 of each
// text to accept, as a fresh database has. Each file first checks that the schema is still the
// one the migrations made: nothing recreates the database between files.
let database: TestDatabase;

// On the local file, the tests listed in tests/local/skips.txt are skipped, each with its reason in the report.
if (localRun) {
  const skips = localSkips();
  beforeEach((context) => {
    const reason = skips.get(fullName(context.task as never));
    if (reason) context.skip(reason);
  });
}

beforeAll(async () => {
  database = inject('testDatabase');
  if (database.local) {
    prisma = (await import('../src/lib/prisma')).prisma as unknown as Client;
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string; type: string; sql: string | null }>>(SCHEMA_ROWS);
    if (schemaDigest(rows) !== database.local.schema) {
      throw new Error('The local test file\'s schema is no longer the one the migrations made: a test in this file changed it.');
    }
    return;
  }
  assertTestDatabase();
  const [schema] = await prisma.$queryRawUnsafe<{ fingerprint: string }[]>(SCHEMA_FINGERPRINT);
  if (schema.fingerprint !== database.schema) {
    throw new Error(
      'The test database schema is no longer the one the migrations made at the start of the run: ' +
        'a test in an earlier file changed it and did not undo it (one that timed out before its `finally`?), ' +
        'or a migration was applied during `test:watch`. Fix that test, or restart watch mode: a new run creates a fresh database.'
    );
  }
});

beforeEach(async () => {
  if (database.local) {
    // Foreign keys off outside the transaction (a pragma has no effect inside one), every table emptied in one
    // transaction, so one sync instead of one per table.
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF');
    try {
      await prisma.$transaction(database.local.tables.map((table) => prisma.$executeRawUnsafe(`DELETE FROM "${table}"`)) as never);
    } finally {
      await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    }
    return;
  }
  await prisma.$executeRawUnsafe(database.emptyEveryTable);
  await prisma.$executeRaw`
    INSERT INTO lingo_testi_versioni
    SELECT * FROM json_populate_recordset(NULL::lingo_testi_versioni, ${database.seededTexts}::json)`;
});

export { prisma };
