import { describe, it, expect, afterEach } from 'vitest';
import { copyFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { configure, setLocalKey, takeLocalKey } from '../../src/local/database';
import { newLocalDatabase } from './client';

/** The encrypted local client (spec §3). */
let cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups = [];
});

async function withRows() {
  const local = newLocalDatabase();
  cleanups.push(() => local.remove());
  const user = await local.prisma.user.create({ data: { email: 'locale@example.invalid', username: 'locale', password: 'x' } });
  await local.prisma.dossier.create({ data: { name: 'Pratica riservata inventata', userId: user.id } });
  await local.prisma.$disconnect();
  return local;
}

describe('the encrypted local client', () => {
  it('leaves no readable SQLite file and no readable text on disk', async () => {
    const local = await withRows();
    const bytes = readFileSync(local.file);
    expect(bytes.subarray(0, 15).toString('latin1')).not.toBe('SQLite format 3');
    expect(bytes.includes(Buffer.from('Pratica riservata inventata'))).toBe(false);
  });

  it('refuses a wrong key with "file is not a database"', async () => {
    const local = await withRows();
    const db = new Database(local.file);
    try {
      expect(() => configure(db, randomBytes(32).toString('hex'))).toThrow(/file is not a database/);
    } finally {
      db.close();
    }
  });

  it('refuses a file with one flipped bit in a data page', async () => {
    const local = await withRows();
    const copy = `${local.file}.tampered`;
    copyFileSync(local.file, copy);
    const bytes = readFileSync(copy);
    const pages = Math.floor(statSync(copy).size / 4096);
    const at = 4096 * Math.max(1, pages - 2) + 1500;
    bytes[at] ^= 1;
    writeFileSync(copy, bytes);
    const db = new Database(copy);
    try {
      expect(() => {
        configure(db, local.keyHex);
        for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]) {
          db.prepare(`SELECT * FROM "${name}"`).all();
        }
      }).toThrow(/malformed|not a database/);
    } finally {
      db.close();
    }
  });

  it('sets the pragmas of the spec on its connection', async () => {
    const local = newLocalDatabase();
    cleanups.push(() => local.remove(), () => local.prisma.$disconnect());
    const read = async (name: string) => Object.values((await local.prisma.$queryRawUnsafe<Record<string, unknown>[]>(`PRAGMA ${name}`))[0])[0];
    expect(await read('journal_mode')).toBe('wal');
    expect(Number(await read('synchronous'))).toBe(2);
    expect(Number(await read('foreign_keys'))).toBe(1);
    expect(Number(await read('temp_store'))).toBe(2);
    expect(await read('locking_mode')).toBe('exclusive');
    if (process.platform === 'darwin') expect(Number(await read('fullfsync'))).toBe(1);
  });

  it('hands the key over once and keeps it out of process.env', () => {
    const keyHex = randomBytes(32).toString('hex');
    setLocalKey(keyHex);
    expect(takeLocalKey()).toBe(keyHex);
    expect(() => takeLocalKey()).toThrow(/no database key/);
    expect(Object.values(process.env)).not.toContain(keyHex);
    expect(() => setLocalKey('not-a-key')).toThrow(/64 lower-case hex/);
  });
});
