/**
 * The test database, shared by `tests/globalSetup.ts` (once per run: the reset, and what the
 * files need from the freshly migrated database) and `tests/setup.ts` (in every file: the guard,
 * and emptying the tables before each test).
 */

/** What the global setup reads once, right after the reset, and hands to every test file. */
export type TestDatabase = {
  /** One statement that deletes every row of every table but `_prisma_migrations`. */
  emptyEveryTable: string;
  /** The text versions the migrations insert, as a JSON array of rows. */
  seededTexts: string;
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
// target DB name clearly looks like a test database.
export function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  const dbName = url.split('/').pop()?.split('?')[0] ?? '';
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to run tests: DATABASE_URL points at "${dbName || '(unset)'}", ` +
        `which does not look like a test database. Run tests via "npm test" ` +
        `(which loads .env.test) — never "npx vitest" directly.`
    );
  }
}

/** A foreign key: `child` references `parent`, and what Postgres does to the child's rows when a parent row goes. */
export type Reference = {
  child: string;
  parent: string;
  onDelete: 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default';
};

/** The actions with which a parent row may go while rows still reference it: Postgres deletes or detaches them. */
const RESOLVED_BY_POSTGRES: ReadonlySet<Reference['onDelete']> = new Set(['cascade', 'set null']);

/**
 * The tables in an order in which each can be emptied with a plain DELETE: every table after
 * all the tables that reference it, so no foreign key points at a row already gone and no
 * `ON DELETE` action finds anything to do. A table that references itself is emptied by one
 * statement, which a foreign key allows. Where the keys form a cycle (a dossier and the Forum
 * item published from it; a glossa and its accepted reply), one table of it goes first, the
 * first by name whose referencing rows are all deleted or detached by Postgres itself
 * (`ON DELETE CASCADE` or `SET NULL`). A cycle held only by `RESTRICT` or `NO ACTION` keys
 * cannot be emptied this way and stops the run, naming its tables. Ties go by name, so the
 * order is the same on every run.
 */
export function deletionOrder(tables: readonly string[], references: readonly Reference[]): string[] {
  const left = new Set([...tables].sort());
  // The tables not yet emptied that reference `table` (only through the keys that would refuse its DELETE, when `blocking`).
  const heldBy = (table: string, blocking: boolean) =>
    references.some(
      (r) => r.parent === table && r.child !== table && left.has(r.child) && !(blocking && RESOLVED_BY_POSTGRES.has(r.onDelete))
    );
  const order: string[] = [];
  while (left.size > 0) {
    let ready = [...left].filter((table) => !heldBy(table, false));
    if (ready.length === 0) ready = [...left].filter((table) => !heldBy(table, true)).slice(0, 1);
    if (ready.length === 0) {
      throw new Error(
        `The foreign keys among ${[...left].join(', ')} form a cycle of RESTRICT or NO ACTION keys: ` +
          'no order of DELETEs empties them (tests/testDatabase.ts).'
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
