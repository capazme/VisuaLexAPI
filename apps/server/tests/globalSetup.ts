import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { TestProject } from 'vitest/node';
import { dropAddedSince } from './devEnvGuard';
import {
  SCHEMA_FINGERPRINT,
  assertTestDatabase,
  databaseName,
  deletionOrder,
  emptyingStatement,
  isRunDatabaseOf,
  quoteIdentifier,
  runDatabaseName,
  withDatabase,
  type Reference,
} from './testDatabase';
import { createLocalRun, isLocalRun } from './localRun';

/**
 * Once per run, before the first test file: a database of the run's own is created next to the one
 * DATABASE_URL names, every migration is applied to it with `prisma migrate deploy`, and it is read
 * for what each test needs to start from the same state (`tests/setup.ts`): its URL, the DELETE of
 * every table, ordered by the foreign keys the migrations made, the text versions the migrations
 * insert, and the schema's fingerprint. At the end of the run the database is dropped.
 *
 * Nothing drops data through Prisma's CLI: Prisma 7 refuses its reset when an AI agent runs it, a
 * safeguard that is never worked around (G-542), and the repository refuses that reset by hand too.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  if (isLocalRun()) return setupLocal(project);
  assertTestDatabase();
  const baseUrl = process.env.DATABASE_URL ?? '';
  const base = databaseName(baseUrl);
  const name = runDatabaseName(base, process.pid, randomBytes(3).toString('hex'));
  const runUrl = withDatabase(baseUrl, name);
  assertTestDatabase(runUrl);

  // The test files run in processes forked from this one and inherit its environment: whatever the
  // imports below add to it goes at once (`tests/devEnvGuard.ts`). Prisma 7 itself loads no `.env`.
  const known = new Set(Object.keys(process.env));
  const { PrismaClient } = await import('../src/lib/db');
  const { createPgAdapter } = await import('../src/lib/pgAdapter');
  dropAddedSince(known);

  // CREATE and DROP DATABASE run on the server's maintenance database, outside any transaction.
  const onServer = async (statement: string): Promise<void> => {
    const admin = new PrismaClient({ adapter: createPgAdapter(withDatabase(baseUrl, 'postgres')) });
    try {
      await admin.$executeRawUnsafe(statement);
    } finally {
      await admin.$disconnect();
    }
  };
  const dropRunDatabase = async (): Promise<void> => {
    // Only the database this run created: the guard of the name, again, before anything is dropped.
    if (!isRunDatabaseOf(name, base)) throw new Error(`Refusing to drop "${name}": not a database of this run.`);
    await onServer(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE)`);
  };

  await onServer(`CREATE DATABASE ${quoteIdentifier(name)}`);
  try {
    // The child applies the migrations to the run's database only. Its output is kept, so a failed
    // migration throws with Prisma's own words.
    execSync('npx prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: runUrl } });

    const prisma = new PrismaClient({ adapter: createPgAdapter(runUrl) });
    try {
      const tables = await prisma.$queryRaw<{ name: string }[]>`
        SELECT tablename::text AS name FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
      const references = await prisma.$queryRaw<Reference[]>`
        SELECT child.relname::text AS child, parent.relname::text AS parent,
          CASE fk.confdeltype WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade' WHEN 'n' THEN 'set null'
            WHEN 'd' THEN 'set default' ELSE 'no action' END AS "onDelete"
        FROM pg_constraint fk
        JOIN pg_class child ON child.oid = fk.conrelid
        JOIN pg_class parent ON parent.oid = fk.confrelid
        WHERE fk.contype = 'f'
          AND child.relnamespace = 'public'::regnamespace
          AND parent.relnamespace = 'public'::regnamespace`;
      // The text versions the migrations insert (version 1 of each notice to accept). Emptying
      // the tables takes them too, so each test puts them back from this copy: the migration
      // stays the one place that holds their wording and every test starts from "one version,
      // number 1". Read once here, before any test can add a version.
      const [texts] = await prisma.$queryRaw<{ rows: string; count: number }[]>`
        SELECT coalesce(json_agg(t ORDER BY t.chiave, t.versione), '[]')::text AS rows, count(*)::int AS count
        FROM lingo_testi_versioni t`;
      if (texts.count === 0) throw new Error('The migrations seed no text version: expected version 1 of PROPOSTA_SCHEDA.');
      const [schema] = await prisma.$queryRawUnsafe<{ fingerprint: string }[]>(SCHEMA_FINGERPRINT);
      project.provide('testDatabase', {
        url: runUrl,
        emptyEveryTable: emptyingStatement(deletionOrder(tables.map((t) => t.name), references)),
        seededTexts: texts.rows,
        schema: schema.fingerprint,
      });
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    // The setup's own error is the one to see: a failed drop is only reported beside it.
    await dropRunDatabase().catch((dropError: unknown) => {
      console.error(`[globalSetup] could not drop ${name} after the failure below:`, dropError);
    });
    throw error;
  }
  return dropRunDatabase;
}

/**
 * `LEXCRAFT_TEST_DB=local`: no Postgres at all. A folder of the run's own under the temp folder, a template file
 * migrated by the app (`tests/localRun.ts`), and the folder removed at the end.
 */
async function setupLocal(project: TestProject): Promise<() => Promise<void>> {
  const known = new Set(Object.keys(process.env));
  const { run, remove } = await createLocalRun();
  dropAddedSince(known);
  project.provide('testDatabase', { url: `file:${run.template}`, emptyEveryTable: '', seededTexts: '[]', schema: run.schema, local: run });
  return async () => remove();
}
