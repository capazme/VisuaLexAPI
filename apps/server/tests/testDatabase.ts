import type { LocalRun } from './localRun';

/**
 * The test database, shared by `tests/globalSetup.ts` (once per run: a database of the run's own,
 * migrated, and what the files need from it) and `tests/setup.ts` (in every file: the guards, and
 * emptying the tables before each test).
 */

/** What the global setup reads once, right after the migrations, and hands to every test file. */
export type TestDatabase = {
  /** The URL of the run's own database, which every test file uses as its DATABASE_URL. */
  url: string;
  /** One statement that deletes every row of every table but `_prisma_migrations`. */
  emptyEveryTable: string;
  /** The text versions the migrations insert, as a JSON array of rows. */
  seededTexts: string;
  /** `SCHEMA_FINGERPRINT` of the schema the migrations made. */
  schema: string;
  /** Set when the run is on the desktop app's encrypted local file instead (`tests/localRun.ts`). */
  local?: LocalRun;
};

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabase: TestDatabase;
  }
}

/**
 * The database a URL names: the first segment of its path, the one the driver connects to; never what
 * follows a `/` in the query (`?sslrootcert=/certs/test-ca.pem` names no database) or in a later
 * segment (`/visualex_platform/visualex_test` names `visualex_platform`). Empty when it is not a URL.
 */
export function databaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/')[1] ?? '');
  } catch {
    return '';
  }
}

// SAFETY GUARD: the global setup creates and drops a database next to the one DATABASE_URL names,
// and every test empties its tables. If vitest is run WITHOUT the `dotenv -e .env.test` wrapper
// (i.e. `npx vitest` instead of `npm test`), DATABASE_URL may point at the DEV database
// (visualex_platform). Refuse to run unless the target DB name clearly looks like a test database.
export function assertTestDatabase(url: string = process.env.DATABASE_URL ?? ''): void {
  const dbName = databaseName(url);
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to run tests: DATABASE_URL points at "${dbName || '(no database name)'}", ` +
        `which does not look like a test database. Run tests via "npm test" ` +
        `(which loads .env.test) — never "npx vitest" directly.`
    );
  }
}

/**
 * The run's own database: the test database's name, `_run_`, the process id and a random suffix,
 * so two runs on one server never meet. It keeps «test» from the name it extends (the guard above),
 * and only lower-case letters, digits and underscores, within Postgres' 63 characters.
 */
export function runDatabaseName(base: string, pid: number, random: string): string {
  const name = `${base}_run_${pid}_${random}`.toLowerCase();
  if (!/test/i.test(base) || !/^[a-z0-9_]+$/.test(name) || name.length > 63) {
    throw new Error(`Refusing the run database name "${name}": it must extend a test database's name, in [a-z0-9_], within 63 characters.`);
  }
  return name;
}

/** Whether `name` is a run database made from `base` by `runDatabaseName`. */
export function isRunDatabaseOf(name: string, base: string): boolean {
  return /test/i.test(base) && name.startsWith(`${base.toLowerCase()}_run_`) && /^[a-z0-9_]+_run_\d+_[a-f0-9]+$/.test(name);
}

/** The same URL, naming another database. */
export function withDatabase(url: string, name: string): string {
  const next = new URL(url);
  next.pathname = `/${encodeURIComponent(name)}`;
  return next.toString();
}

/** A Postgres identifier, quoted. */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * One hash over the schema of `public`: every column with its type, nullability and default,
 * every constraint, index and trigger, every enum value. The database is not recreated before each
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
