/**
 * The few pieces of hand-written SQL that differ between the online server's Postgres and the desktop app's local
 * SQLite (G-612; spec §5 of docs/superpowers/specs/2026-11-26-desktop-local-mode-design.md), in one place.
 *
 * Row locks and advisory locks are Postgres's way to keep two connections apart. Locally there is one connection,
 * and its lock (src/local/database.ts) already lets no other statement run inside an open transaction, so on SQLite
 * these are nothing. `tests/local/dialect.test.ts` fails when a raw statement under src/ names `FOR UPDATE`,
 * `FOR SHARE` or `pg_advisory` outside this module, but in the files of the sections that stay online.
 */
import { Prisma } from './db';

const local = (): boolean => process.env.LEXCRAFT_MODE === 'local';
const TABLE = /^[a-z_][a-z0-9_]*$/;

type RowLock = 'UPDATE' | 'NO KEY UPDATE' | 'SHARE' | 'KEY SHARE';

function rowLock(kind: RowLock, of: string[]): Prisma.Sql {
  if (local()) return Prisma.empty;
  for (const table of of) if (!TABLE.test(table)) throw new Error(`[sqlDialect] not a table alias: ${table}`);
  return Prisma.raw(` FOR ${kind}${of.length > 0 ? ` OF ${of.join(', ')}` : ''}`);
}

/** ` FOR UPDATE` (or ` FOR UPDATE OF <tables>`) on Postgres; nothing on SQLite. Goes at the end of a SELECT. */
export const forUpdate = (...of: string[]): Prisma.Sql => rowLock('UPDATE', of);

/** ` FOR NO KEY UPDATE` on Postgres; nothing on SQLite. */
export const forNoKeyUpdate = (...of: string[]): Prisma.Sql => rowLock('NO KEY UPDATE', of);

/** Postgres's transaction-scoped advisory lock on a key; nothing on SQLite. */
export async function advisoryXactLock(tx: Pick<Prisma.TransactionClient, '$executeRaw'>, key: string): Promise<void> {
  if (local()) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/**
 * The current time in UTC, for a raw write to a datetime column: on Postgres `now() AT TIME ZONE 'UTC'` (a TIMESTAMP
 * holding UTC, as Prisma writes it); on SQLite the driver adapter's own text format (spec §2).
 */
export function utcNow(): Prisma.Sql {
  return local() ? Prisma.raw("strftime('%Y-%m-%dT%H:%M:%f+00:00','now')") : Prisma.raw("(now() AT TIME ZONE 'UTC')");
}

/** A Json column read by raw SQL: Postgres hands back the value, SQLite its text. */
export function jsonValue<T>(value: unknown): T {
  return (typeof value === 'string' && local() ? JSON.parse(value) : value) as T;
}
