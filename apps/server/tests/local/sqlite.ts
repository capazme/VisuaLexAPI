import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { LOCAL_INIT } from '../../scripts/local-schema';

/**
 * Test helpers for the desktop app's local database (G-612): an encrypted SQLite file in a temporary folder,
 * made from `prisma/local/init.sql`, with a key generated for the test. SQLite3MultipleCiphers refuses a key on
 * an in-memory database, so the file is real and removed afterwards. Task 4's `src/local/database.ts` will give
 * the app's own client; until then the tests key the adapter themselves.
 */
export type LocalFile = { file: string; keyHex: string; remove: () => void };

export function key(db: Database.Database, keyHex: string): void {
  db.pragma(`cipher='chacha20'`);
  db.pragma(`key="x'${keyHex}'"`);
}

/** A new encrypted file with the whole local schema. */
export function newLocalFile(): LocalFile {
  const dir = mkdtempSync(path.join(tmpdir(), 'lexcraft-local-'));
  const file = path.join(dir, 'lexcraft.db');
  const keyHex = randomBytes(32).toString('hex');
  const db = new Database(file);
  key(db, keyHex);
  db.exec('BEGIN');
  db.exec(readFileSync(LOCAL_INIT, 'utf8'));
  db.exec('COMMIT');
  db.close();
  return { file, keyHex, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * The file opened with its key, foreign keys off: these tests look at single tables. (This SQLite3MultipleCiphers
 * build turns foreign keys on by default, unlike stock SQLite; the app's client sets them on explicitly anyway.)
 */
export function openLocalFile(local: LocalFile): Database.Database {
  const db = new Database(local.file);
  key(db, local.keyHex);
  db.pragma('foreign_keys=OFF');
  return db;
}

/** The Prisma 7 adapter on the encrypted file: the key is the first thing the connection hears. */
export function keyedAdapter(local: LocalFile): PrismaBetterSqlite3 {
  class Keyed extends PrismaBetterSqlite3 {
    async connect() {
      const adapter = await super.connect();
      key((adapter as unknown as { client: Database.Database }).client, local.keyHex);
      return adapter;
    }
  }
  return new Keyed({ url: `file:${local.file}` });
}
