import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma-local/client';
import { keyedAdapter, newLocalFile, type LocalFile } from './sqlite';

/**
 * One datetime format in the local file (spec §2). The adapter writes `2026-11-26T21:23:56.349+00:00`; a column's
 * default used to be SQLite's `CURRENT_TIMESTAMP` (`2026-11-26 21:23:56`), and the two compared wrongly as text:
 * a filter on `createdAt` found one row of two, and raw SQL read the default one hour off (measured).
 */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/;
let local: LocalFile | null = null;
let prisma: PrismaClient | null = null;

afterEach(async () => {
  await prisma?.$disconnect();
  local?.remove();
  prisma = null;
  local = null;
});

describe('datetimes in the local file', () => {
  it('a row written by raw SQL, with the column default, and one written by Prisma share one format', async () => {
    local = newLocalFile();
    prisma = new PrismaClient({ adapter: keyedAdapter(local) });
    const user = await prisma.user.create({ data: { email: 'locale@example.invalid', username: 'locale', password: 'x' } });
    const before = new Date(Date.now() - 2000);
    const viaPrisma = randomUUID();
    const viaSql = randomUUID();
    await prisma.highlight.create({ data: { id: viaPrisma, userId: user.id, normaKey: 'k::art::1', text: 'passo', color: 'yellow', startOffset: 0, endOffset: 5 } });
    await prisma.$executeRawUnsafe(
      `INSERT INTO highlights (id, user_id, norma_key, text, color, start_offset, end_offset, kind) VALUES (?, ?, 'k::art::2', 'passo', 'yellow', 0, 5, 'mark')`,
      viaSql,
      user.id,
    );
    const stored = await prisma.$queryRawUnsafe<{ id: string; c: string }[]>(
      `SELECT id, CAST(created_at AS TEXT) AS c FROM highlights WHERE id IN (?, ?)`,
      viaPrisma,
      viaSql,
    );
    expect(stored).toHaveLength(2);
    for (const row of stored) expect(row.c).toMatch(ISO);
    const found = await prisma.highlight.count({ where: { id: { in: [viaPrisma, viaSql] }, createdAt: { gte: before } } });
    expect(found).toBe(2);
    const read = await prisma.highlight.findUniqueOrThrow({ where: { id: viaSql } });
    expect(Math.abs(read.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
  });
});
