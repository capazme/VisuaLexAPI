import { describe, it, expect } from 'vitest';
import { prisma as serverPrisma } from '../src/lib/prisma';
import { Prisma } from '../src/lib/db';
import { pgAdapterOptions } from '../src/lib/pgAdapter';
import { prisma, createTestUser } from './helpers';

/**
 * Prisma 7 through @prisma/adapter-pg (G-612): what the server relies on from the ORM, held to what Prisma 5 did,
 * on the server's own client (src/lib/prisma.ts), which carries the pool settings.
 */
describe('Prisma 7 on Postgres', () => {
  it('round-trips a Bytes field byte for byte', async () => {
    const user = await createTestUser('p7_bytes');
    const dossier = await prisma.dossier.create({ data: { name: 'Bytes', userId: user.id } });
    const key = Uint8Array.from([0, 1, 2, 250, 255]);
    const created = await serverPrisma.praticaFile.create({
      data: { userId: user.id, dossierId: dossier.id, nome: 'atto.txt', mime: 'text/plain', peso: 5, sha256: 'x', chiaveCifrata: key },
    });
    const back = await serverPrisma.praticaFile.findUniqueOrThrow({ where: { id: created.id } });
    expect(Buffer.compare(Buffer.from(back.chiaveCifrata), Buffer.from(key))).toBe(0);
  });

  it('still reports a unique violation as PrismaClientKnownRequestError P2002', async () => {
    const user = await createTestUser('p7_unique');
    const error = await serverPrisma.user
      .create({ data: { email: user.email, username: 'p7_unique_again', password: 'x' } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
  });

  it('answers twenty queries in parallel within the pool', async () => {
    const started = Date.now();
    const results = await Promise.all(Array.from({ length: 20 }, () => serverPrisma.$queryRaw<{ one: number }[]>`SELECT 1::int AS one`));
    expect(results.every((rows) => rows[0].one === 1)).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('rolls an interactive transaction back when it throws', async () => {
    const user = await createTestUser('p7_rollback');
    await serverPrisma
      .$transaction(async (tx) => {
        await tx.dossier.create({ data: { name: 'Mai', userId: user.id } });
        throw new Error('stop');
      })
      .catch(() => undefined);
    expect(await prisma.dossier.count({ where: { userId: user.id, name: 'Mai' } })).toBe(0);
  });
});

describe('the pg pool settings from DATABASE_URL', () => {
  it("maps Prisma 5's URL parameters and takes them out of the URL node-postgres sees", () => {
    const { pool, schema } = pgAdapterOptions(
      'postgresql://u:p@db.example:5432/app?schema=public&connection_limit=5&pool_timeout=20&connect_timeout=3&sslmode=disable',
    );
    expect(pool.max).toBe(5);
    expect(pool.connectionTimeoutMillis).toBe(20_000);
    expect(pool.idleTimeoutMillis).toBe(300_000);
    expect(schema).toBe('public');
    expect(pool.connectionString).toBe('postgresql://u:p@db.example:5432/app?sslmode=disable');
  });

  it("keeps Prisma 5's defaults when the URL names none", () => {
    const { pool, schema } = pgAdapterOptions('postgresql://u:p@db.example:5432/app');
    expect(pool.max).toBeGreaterThanOrEqual(3);
    expect(pool.max).toBeLessThanOrEqual(40);
    expect(pool.connectionTimeoutMillis).toBe(10_000);
    expect(schema).toBeUndefined();
  });

  it('does not throw without a URL', () => {
    expect(() => pgAdapterOptions('')).not.toThrow();
  });
});
