/**
 * The test database, shared by `tests/globalSetup.ts` (once per run: the reset, and what the
 * files need from the freshly migrated database) and `tests/setup.ts` (in every file: the guards,
 * and emptying the tables before each test).
 */

/** What the global setup reads once, right after the reset, and hands to every test file. */
export type TestDatabase = {
  /** One statement that deletes every row of every table but `_prisma_migrations`. */
  emptyEveryTable: string;
  /** The text versions the migrations insert, as a JSON array of rows. */
  seededTexts: string;
  /** `SCHEMA_FINGERPRINT` of the schema the migrations made. */
  schema: string;
};

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabase: TestDatabase;
  }
}

// SAFETY GUARD: the global setup resets the database (drops everything) and every test
// empties its tables. If vitest is run WITHOUT the `dotenv -e .env.test` wrapper (i.e.
// `npx vitest` instead of `npm test`), Prisma loads `.env` and DATABASE_URL points at the DEV
// database (visualex_platform) — the reset then wipes dev data. Refuse to run unless the
// target DB name clearly looks like a test database. The name is the first segment of the
// URL's path, the one Prisma connects to: never what follows a `/` in the query
// (`?sslrootcert=/certs/test-ca.pem` names no database) or in a later segment
// (`/visualex_platform/visualex_test` names `visualex_platform`).
export function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  let dbName = '';
  try {
    dbName = decodeURIComponent(new URL(url).pathname.split('/')[1] ?? '');
  } catch {
    // Not a URL: no database name, refused below.
  }
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to run tests: DATABASE_URL points at "${dbName || '(no database name)'}", ` +
        `which does not look like a test database. Run tests via "npm test" ` +
        `(which loads .env.test) — never "npx vitest" directly.`
    );
  }
}

/**
 * One hash over the schema of `public`: every column with its type, nullability and default,
 * every constraint, index and trigger, every enum value. The reset no longer runs before each
 * file, so a schema change a test leaves behind (a `CHECK` whose `finally` never ran because the
 * test timed out) would reach every later file; each file compares this with the run's start.
 */
export const SCHEMA_FINGERPRINT = `
  SELECT md5(string_agg(line, E'\\n' ORDER BY line)) AS fingerprint FROM (
    SELECT format('column %s.%s %s %s %s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod),
      a.attnotnull, pg_get_expr(d.adbin, d.adrelid)) AS line
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT format('constraint %s %s %s', conrelid::regclass, conname, pg_get_constraintdef(oid))
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace
    UNION ALL
    SELECT format('index %s', pg_get_indexdef(i.indexrelid))
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relnamespace = 'public'::regnamespace
    UNION ALL
    SELECT format('trigger %s', pg_get_triggerdef(t.oid))
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
    UNION ALL
    -- Whether each trigger fires, the foreign keys' own included: a DISABLE TRIGGER ALL left behind
    -- would silently stop checking them.
    SELECT format('trigger state %s %s', c.relname, t.tgenabled)
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'public'::regnamespace
    UNION ALL
    SELECT format('enum %s %s %s', t.typname, e.enumsortorder, e.enumlabel)
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typnamespace = 'public'::regnamespace
  ) AS schema`;

/** A foreign key: `child` references `parent`, and what Postgres does to the child's rows when a parent row goes. */
export type Reference = {
  child: string;
  parent: string;
  onDelete: 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default';
};

/**
 * The tables in an order in which each can be emptied with a plain DELETE: every table after
 * all the tables that reference it, so no foreign key points at a row already gone and no
 * `ON DELETE` action finds anything to do. A table that references itself is emptied by one
 * statement, which a foreign key allows. Where the keys form a cycle (a dossier and the Forum
 * item published from it; a glossa and its accepted reply), one table of it goes first: the
 * first by name whose remaining referencing keys are all `ON DELETE SET NULL`, so Postgres only
 * detaches those rows and nothing cascades further. A cycle with no such table stops the run,
 * listing the tables not yet ordered (the cycle's and those it holds back). Ties go by name, so
 * the order is the same on every run.
 */
export function deletionOrder(tables: readonly string[], references: readonly Reference[]): string[] {
  const left = new Set([...tables].sort());
  // Whether a table not yet emptied references `table` (with `detached`, through a key other than SET NULL).
  const heldBy = (table: string, detached: boolean) =>
    references.some(
      (r) => r.parent === table && r.child !== table && left.has(r.child) && !(detached && r.onDelete === 'set null')
    );
  const order: string[] = [];
  while (left.size > 0) {
    let ready = [...left].filter((table) => !heldBy(table, false));
    if (ready.length === 0) ready = [...left].filter((table) => !heldBy(table, true)).slice(0, 1);
    if (ready.length === 0) {
      throw new Error(
        `A cycle of foreign keys that no ON DELETE SET NULL key breaks holds back ${[...left].join(', ')}: ` +
          'tests/testDatabase.ts cannot order their DELETEs.'
      );
    }
    for (const table of ready) {
      order.push(table);
      left.delete(table);
    }
  }
  return order;
}

/** One round trip for every DELETE, in the order given. */
export function emptyingStatement(order: readonly string[]): string {
  const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
  return `DO $$ BEGIN ${order.map((table) => `DELETE FROM ${quote(table)};`).join(' ')} END $$`;
}
