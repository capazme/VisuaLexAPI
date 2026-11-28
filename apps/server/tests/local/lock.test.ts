import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { serialize } from '../../src/local/database';
import { newLocalDatabase } from './client';

/**
 * One connection, one lock (spec §3). Without it, the adapter ran a plain query inside another request's open
 * transaction: the write was acknowledged, then vanished with that transaction's rollback (measured).
 */
let cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups = [];
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the connection lock', () => {
  it('a plain write during an open transaction waits, reads nothing uncommitted, and survives its rollback', async () => {
    const local = newLocalDatabase();
    cleanups.push(() => local.remove(), () => local.prisma.$disconnect());
    const { prisma } = local;
    const user = await prisma.user.create({ data: { email: 'a@example.invalid', username: 'a', password: 'x' } });
    const dossier = await prisma.dossier.create({ data: { name: 'Prima', userId: user.id, description: 'prima' } });
    const marker = `tx-${randomUUID()}`;
    const a = prisma
      .$transaction(async (tx) => {
        await tx.dossier.update({ where: { id: dossier.id }, data: { description: marker } });
        await sleep(200);
        throw new Error('A fails on purpose');
      }, { timeout: 5000 })
      .catch(() => 'rolled back');
    await sleep(50);
    const started = Date.now();
    const b = await prisma.highlight.create({ data: { userId: user.id, normaKey: 'k::art::1', text: 'passo', color: 'yellow', startOffset: 0, endOffset: 5 } });
    const waited = Date.now() - started;
    const seen = await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } });
    expect(await a).toBe('rolled back');
    expect(waited).toBeGreaterThanOrEqual(100);
    expect(seen.description).toBe('prima');
    expect(await prisma.highlight.findUnique({ where: { id: b.id } })).not.toBeNull();
    expect((await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } })).description).toBe('prima');
  });

  it('commits a transaction, and runs the next query after it', async () => {
    const local = newLocalDatabase();
    cleanups.push(() => local.remove(), () => local.prisma.$disconnect());
    const { prisma } = local;
    const user = await prisma.$transaction(async (tx) => tx.user.create({ data: { email: 'b@example.invalid', username: 'b', password: 'x' } }));
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
  });

  it('a BEGIN that fails releases the lock: the next query and the next transaction both run', async () => {
    let failBegin = true;
    const calls: string[] = [];
    const fake = {
      provider: 'sqlite' as const,
      adapterName: 'fake',
      queryRaw: async () => { calls.push('query'); return { columnNames: [], columnTypes: [], rows: [] }; },
      executeRaw: async ({ sql }: { sql: string }) => {
        calls.push(sql);
        if (sql === 'BEGIN' && failBegin) { failBegin = false; throw new Error('cannot begin'); }
        return 0;
      },
      executeScript: async () => undefined,
      startTransaction: async () => { throw new Error('the adapter\'s own startTransaction must never be called'); },
      dispose: async () => undefined,
    };
    const adapter = serialize(fake as never);
    await expect(adapter.startTransaction()).rejects.toThrow('cannot begin');
    const next = await Promise.race([adapter.queryRaw({ sql: 'SELECT 1', args: [], argTypes: [] }).then(() => 'ran'), sleep(500).then(() => 'hung')]);
    expect(next).toBe('ran');
    const tx = await Promise.race([adapter.startTransaction(), sleep(500).then(() => null)]);
    expect(tx).not.toBeNull();
    await tx!.commit();
    expect(calls).toEqual(['BEGIN', 'query', 'BEGIN']);
  });

  it('a rollback after a failed COMMIT closes the transaction SQLite kept open, before the lock goes', async () => {
    const calls: string[] = [];
    const client = { inTransaction: false };
    const fake = {
      provider: 'sqlite' as const,
      adapterName: 'fake',
      client,
      queryRaw: async () => ({ columnNames: [], columnTypes: [], rows: [] }),
      executeRaw: async ({ sql }: { sql: string }) => {
        calls.push(sql);
        if (sql === 'BEGIN') client.inTransaction = true;
        if (sql === 'COMMIT') throw new Error('disk full');
        if (sql === 'ROLLBACK') client.inTransaction = false;
        return 0;
      },
      executeScript: async () => undefined,
      startTransaction: async () => { throw new Error('never'); },
      dispose: async () => undefined,
    };
    const adapter = serialize(fake as never);
    const tx = await adapter.startTransaction();
    await expect(tx.executeRaw({ sql: 'COMMIT', args: [], argTypes: [] })).rejects.toThrow('disk full');
    await tx.rollback();
    expect(client.inTransaction).toBe(false);
    expect(calls).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK']);
    const next = await Promise.race([adapter.queryRaw({ sql: 'SELECT 1', args: [], argTypes: [] }).then(() => 'ran'), sleep(500).then(() => 'hung')]);
    expect(next).toBe('ran');
  });

  it('refuses an isolation level SQLite does not offer', async () => {
    const fake = { provider: 'sqlite', adapterName: 'fake', queryRaw: async () => ({}), executeRaw: async () => 0, executeScript: async () => undefined, startTransaction: async () => ({}), dispose: async () => undefined };
    await expect(serialize(fake as never).startTransaction('READ COMMITTED')).rejects.toThrow(/not supported/);
  });
});
