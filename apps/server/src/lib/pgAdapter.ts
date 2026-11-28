import os from 'node:os';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * The pg pool's settings from DATABASE_URL, as Prisma 5 read them (G-612). Prisma 7 talks to Postgres through
 * node-postgres, whose defaults differ (pool of 10, no connect timeout, idle 10 s): without this the pool would
 * shrink and a request could wait for a connection for ever. Prisma's own URL parameters are taken out of the
 * URL node-postgres sees, and mapped:
 * - `connection_limit` → `max`; without it Prisma 5 used physical CPUs × 2 + 1, here logical CPUs × 2 + 1,
 *   capped at 40 so the server, MERL-T and the tools stay under Postgres' default of 100 connections;
 * - `pool_timeout` (s, Prisma 5 default 10) → `connectionTimeoutMillis`, which in node-postgres covers both
 *   waiting for a pooled connection and opening one (Prisma 5's `connect_timeout` was 5 s);
 * - `schema` → the adapter's `schema` option.
 * Idle connections close after 300 s, as in Prisma 5.
 */
export function pgAdapterOptions(databaseUrl: string): {
  pool: { connectionString: string; max: number; connectionTimeoutMillis: number; idleTimeoutMillis: number };
  schema?: string;
} {
  const fallbackMax = Math.min(os.availableParallelism() * 2 + 1, 40);
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    // No URL yet (`src/config.ts` refuses to start without one): node-postgres reports it at the first query.
    return { pool: { connectionString: databaseUrl, max: fallbackMax, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 300_000 } };
  }
  const take = (name: string): string | null => {
    const value = url.searchParams.get(name);
    url.searchParams.delete(name);
    return value;
  };
  const limit = Number(take('connection_limit'));
  const poolTimeout = Number(take('pool_timeout'));
  const schema = take('schema');
  for (const name of ['connect_timeout', 'socket_timeout', 'pgbouncer', 'statement_cache_size']) take(name);
  return {
    pool: {
      connectionString: url.toString(),
      max: Number.isInteger(limit) && limit > 0 ? limit : fallbackMax,
      connectionTimeoutMillis: (Number.isFinite(poolTimeout) && poolTimeout > 0 ? poolTimeout : 10) * 1000,
      idleTimeoutMillis: 300_000,
    },
    ...(schema ? { schema } : {}),
  };
}

/** The adapter for a Postgres URL. The test harness builds its own clients with it (tests/setup.ts). */
export function createPgAdapter(databaseUrl: string): PrismaPg {
  const { pool, schema } = pgAdapterOptions(databaseUrl);
  return new PrismaPg(pool, schema ? { schema } : undefined);
}
