import { execSync } from 'node:child_process';
import type { TestProject } from 'vitest/node';
import { dropAddedSince } from './devEnvGuard';
import { SCHEMA_FINGERPRINT, assertTestDatabase, deletionOrder, emptyingStatement, type Reference } from './testDatabase';

/**
 * Once per run, before the first test file: the database is reset — dropped and every
 * migration applied again — and read for what each test needs to start from the same state
 * (`tests/setup.ts`): the DELETE of every table, ordered by the foreign keys the migrations
 * made, the text versions the migrations insert, and the schema's fingerprint. Nothing here
 * survives into the files but those three strings.
 */
export default async function setup(project: TestProject): Promise<void> {
  assertTestDatabase();
  // The child gets this process's environment, whose DATABASE_URL the guard has just read
  // (dotenv-cli put `.env.test`'s there; Prisma's CLI loads a `.env` only for names not set).
  // Its output is kept, so a failed reset throws with Prisma's own words.
  execSync('npx prisma migrate reset --force --skip-seed', { stdio: 'pipe', env: process.env });

  // Prisma loads a development `apps/server/.env` at the import and at the construction
  // (`tests/devEnvGuard.ts`); the test files run in processes forked from this one, so
  // whatever it adds goes at once, as `tests/setup.ts` does in each of them. The import
  // stays dynamic and after `known`: a static one would load that `.env` before it.
  const known = new Set(Object.keys(process.env));
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  dropAddedSince(known);
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
      emptyEveryTable: emptyingStatement(deletionOrder(tables.map((t) => t.name), references)),
      seededTexts: texts.rows,
      schema: schema.fingerprint,
    });
  } finally {
    await prisma.$disconnect();
  }
}
