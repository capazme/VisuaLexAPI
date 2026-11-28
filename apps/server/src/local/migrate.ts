/**
 * Migrations of the desktop app's local database, at start-up (spec §4 of
 * docs/superpowers/specs/2026-11-26-desktop-local-mode-design.md). Prisma Migrate cannot open an encrypted file,
 * so the app applies its own SQL, through a direct connection, before the Prisma client opens the file:
 *
 * - a new file gets `init.sql` (always the whole current schema) in one transaction, and every migration folder
 *   shipped with it is recorded as already applied;
 * - an existing file gets an encrypted backup first, then foreign keys off (outside the transaction, where the
 *   pragma works), every pending migration in one transaction, a foreign key check before COMMIT, foreign keys on,
 *   and an integrity check. A failure rolls back and leaves the file as it was, with the backup kept.
 *
 * Foreign keys are off because SQLite rebuilds a table to change it (create, copy, drop, rename): with them on,
 * dropping a parent table deletes its children through `ON DELETE CASCADE`.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { configure, holdInstanceLock } from './database';

export type LocalPaths = {
  /** The encrypted database file. */
  file: string;
  /** Its key: 64 hex characters. */
  keyHex: string;
  /** The folder holding `init.sql` and `migrations/<name>/migration.sql` (prisma/local in the repository). */
  sqlDir: string;
  /** Where backups go. */
  backupsDir: string;
};

export type MigrationResult = { created: boolean; applied: string[]; backup: string | null };

const META = 'CREATE TABLE IF NOT EXISTS "_lexcraft_meta" ("key" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL)';
const RECORD = 'CREATE TABLE IF NOT EXISTS "_lexcraft_migrations" ("name" TEXT NOT NULL PRIMARY KEY, "applied_at" TEXT NOT NULL)';

/** The migration folders shipped, in order. */
export function shippedMigrations(sqlDir: string): string[] {
  const dir = path.join(sqlDir, 'migrations');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => fs.existsSync(path.join(dir, name, 'migration.sql'))).sort();
}

/**
 * An encrypted copy of the open database: `VACUUM INTO` writes a consistent snapshot, encrypted with the same key
 * (measured). The name carries the time without colons, so it is a valid file name on Windows too.
 * M4 adds the change to the backup key (the spec's D1).
 */
export function backupLocal(db: Database.Database, backupsDir: string, label: string): string {
  fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  const target = path.join(backupsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}.db`);
  db.prepare('VACUUM INTO ?').run(target);
  return target;
}

export function migrateLocal({ file, keyHex, sqlDir, backupsDir }: LocalPaths): MigrationResult {
  // One process per data folder, before anything touches the file; kept for the life of the process.
  holdInstanceLock(file);
  const shipped = shippedMigrations(sqlDir);
  const db = new Database(file);
  try {
    configure(db, keyHex);
    // New means no table yet, not an empty file: entering WAL writes the header at once, so a first start that
    // failed half-way leaves a non-empty file with no table, which must be made again, not migrated.
    const tables = db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).get() as { n: number };
    const fresh = tables.n === 0;
    const now = () => new Date().toISOString();
    if (fresh) {
      db.exec('BEGIN');
      try {
        db.exec(fs.readFileSync(path.join(sqlDir, 'init.sql'), 'utf8'));
        db.exec(META);
        db.exec(RECORD);
        const record = db.prepare('INSERT INTO "_lexcraft_migrations" ("name", "applied_at") VALUES (?, ?)');
        for (const name of shipped) record.run(name, now());
        db.exec('COMMIT');
      } catch (error) {
        if (db.inTransaction) db.exec('ROLLBACK');
        throw error;
      }
      return { created: true, applied: [], backup: null };
    }

    db.exec(META);
    db.exec(RECORD);
    const done = new Set((db.prepare('SELECT "name" FROM "_lexcraft_migrations"').all() as { name: string }[]).map((r) => r.name));
    const pending = shipped.filter((name) => !done.has(name));
    if (pending.length === 0) return { created: false, applied: [], backup: null };

    const backup = backupLocal(db, backupsDir, 'before-migration');
    const record = db.prepare('INSERT INTO "_lexcraft_migrations" ("name", "applied_at") VALUES (?, ?)');
    db.pragma('foreign_keys=OFF');
    let current = '';
    try {
      db.exec('BEGIN');
      for (const name of pending) {
        current = name;
        db.exec(fs.readFileSync(path.join(sqlDir, 'migrations', name, 'migration.sql'), 'utf8'));
        record.run(name, now());
      }
      current = '';
      const broken = db.pragma('foreign_key_check') as unknown[];
      if (broken.length > 0) throw new Error(`${broken.length} rows break a foreign key after the migrations`);
      db.exec('COMMIT');
    } catch (error) {
      if (db.inTransaction) db.exec('ROLLBACK');
      const step = current ? ` at ${current}` : '';
      throw new Error(`[local] migration failed${step}; the database is as it was, and a backup is at ${backup}: ${(error as Error).message}`);
    } finally {
      db.pragma('foreign_keys=ON');
    }
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`[local] integrity check after the migrations: ${String(integrity)}; a backup is at ${backup}`);
    return { created: false, applied: pending, backup };
  } finally {
    db.close();
  }
}
