import { describe, it, expect, afterEach } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { configure } from '../../src/local/database';
import { migrateLocal, shippedMigrations } from '../../src/local/migrate';
import { SQL_DIR, localPaths, type LocalDatabase } from './client';

/** Local migrations at start-up, after an encrypted backup, and one process on the file (spec §4). */
let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups = [];
});

/** A copy of prisma/local whose migrations folder the test fills. */
function sqlCopy(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lexcraft-sql-'));
  cpSync(SQL_DIR, dir, { recursive: true });
  rmSync(path.join(dir, 'migrations'), { recursive: true, force: true });
  mkdirSync(path.join(dir, 'migrations'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function addMigration(sqlDir: string, name: string, sql: string): void {
  mkdirSync(path.join(sqlDir, 'migrations', name));
  writeFileSync(path.join(sqlDir, 'migrations', name, 'migration.sql'), sql);
}
function newFile(sqlDir: string): LocalDatabase {
  const local = localPaths(sqlDir);
  cleanups.push(() => local.remove());
  expect(migrateLocal(local).created).toBe(true);
  return local;
}
function open(local: LocalDatabase): Database.Database {
  const db = new Database(local.file);
  configure(db, local.keyHex);
  return db;
}
/** A user, a dossier and three entries, written with foreign keys on. */
function seed(local: LocalDatabase): void {
  const db = open(local);
  db.exec(`INSERT INTO users (id, email, username, password, updated_at) VALUES ('u-1', 'a@example.invalid', 'a', 'x', '2026-11-26T00:00:00.000+00:00')`);
  db.exec(`INSERT INTO dossiers (id, name, user_id, updated_at) VALUES ('d-1', 'Pratica', 'u-1', '2026-11-26T00:00:00.000+00:00')`);
  for (const n of [1, 2, 3]) db.exec(`INSERT INTO dossier_items (id, dossier_id, item_type, title) VALUES ('i-${n}', 'd-1', 'norm', 'art. ${n}')`);
  db.close();
}
/** The rebuild SQLite makes to change a table, as Prisma writes it: new table, copy, drop, rename. */
function rebuildDossiers(local: LocalDatabase): string {
  const db = open(local);
  const ddl = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='dossiers'`).get() as { sql: string }).sql;
  db.close();
  return [
    'PRAGMA defer_foreign_keys=ON;',
    'PRAGMA foreign_keys=OFF;',
    `${ddl.replace('CREATE TABLE "dossiers"', 'CREATE TABLE "new_dossiers"')};`,
    'INSERT INTO "new_dossiers" SELECT * FROM "dossiers";',
    'DROP TABLE "dossiers";',
    'ALTER TABLE "new_dossiers" RENAME TO "dossiers";',
    'PRAGMA foreign_keys=ON;',
    'PRAGMA defer_foreign_keys=OFF;',
  ].join('\n');
}

describe('local migrations', () => {
  it('a new file gets the whole schema in one go, with every shipped migration recorded', () => {
    const local = localPaths();
    cleanups.push(() => local.remove());
    expect(migrateLocal(local)).toEqual({ created: true, applied: [], backup: null });
    const db = open(local);
    const tables = db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='table'`).get() as { n: number };
    const recorded = db.prepare('SELECT count(*) AS n FROM "_lexcraft_migrations"').get() as { n: number };
    db.close();
    expect(tables.n).toBe(82 + 2);
    expect(recorded.n).toBe(shippedMigrations(SQL_DIR).length);
  });

  it('a first start that failed half-way is made again at the next start, not taken for a migrated file', () => {
    const broken = sqlCopy();
    writeFileSync(path.join(broken, 'init.sql'), 'CREATE TABLE "a" ("id" TEXT PRIMARY KEY);\nCREATE TABLE "broken" (');
    const local = localPaths(broken);
    cleanups.push(() => local.remove());
    expect(() => migrateLocal(local)).toThrow();
    expect(readFileSync(local.file).length).toBeGreaterThan(0);
    const good = { ...local, sqlDir: SQL_DIR };
    expect(migrateLocal(good).created).toBe(true);
    const db = open(local);
    expect((db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='table'`).get() as { n: number }).n).toBe(82 + 2);
    db.close();
  });

  it('applies a pending migration once, after an encrypted backup, and records it', () => {
    const sqlDir = sqlCopy();
    const local = newFile(sqlDir);
    seed(local);
    addMigration(sqlDir, '20991231000000_note_column', 'ALTER TABLE "dossiers" ADD COLUMN "nota_prova" TEXT;');
    const first = migrateLocal(local);
    expect(first.applied).toEqual(['20991231000000_note_column']);
    expect(first.backup && existsSync(first.backup)).toBeTruthy();
    expect(migrateLocal(local).applied).toEqual([]);
    const backup = new Database(first.backup!);
    expect(readFileSync(first.backup!).subarray(0, 15).toString('latin1')).not.toBe('SQLite format 3');
    configure(backup, local.keyHex);
    expect((backup.prepare('SELECT count(*) AS n FROM dossier_items').get() as { n: number }).n).toBe(3);
    backup.close();
  });

  it('a migration that fails leaves the file as it was, and its backup is there', () => {
    const sqlDir = sqlCopy();
    const local = newFile(sqlDir);
    seed(local);
    addMigration(sqlDir, '20991231000000_broken', 'ALTER TABLE "dossiers" ADD COLUMN "mai" TEXT;\nSELECT * FROM "no_such_table";');
    expect(() => migrateLocal(local)).toThrow(/migration failed at 20991231000000_broken; the database is as it was/);
    const db = open(local);
    const columns = (db.prepare(`PRAGMA table_info("dossiers")`).all() as { name: string }[]).map((c) => c.name);
    const recorded = db.prepare('SELECT count(*) AS n FROM "_lexcraft_migrations"').get() as { n: number };
    db.close();
    expect(columns).not.toContain('mai');
    expect(recorded.n).toBe(0);
    expect(readdirSync(local.backupsDir).filter((f) => f.endsWith('-before-migration.db'))).toHaveLength(1);
  });

  it('a migration that rebuilds dossiers leaves every dossier_items row', () => {
    const sqlDir = sqlCopy();
    const local = newFile(sqlDir);
    seed(local);
    addMigration(sqlDir, '20991231000000_rebuild_dossiers', rebuildDossiers(local));
    expect(migrateLocal(local).applied).toEqual(['20991231000000_rebuild_dossiers']);
    const db = open(local);
    expect((db.prepare('SELECT count(*) AS n FROM dossier_items').get() as { n: number }).n).toBe(3);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    db.close();
  });

  it('for contrast: the same rebuild with foreign keys on deletes the entries', () => {
    const local = newFile(sqlCopy());
    seed(local);
    const sql = rebuildDossiers(local);
    const db = open(local);
    db.exec('BEGIN');
    db.exec(sql);
    db.exec('COMMIT');
    expect((db.prepare('SELECT count(*) AS n FROM dossier_items').get() as { n: number }).n).toBe(0);
    db.close();
  });
});

describe('one process on the file', () => {
  const tsx = path.resolve(__dirname, '../../node_modules/tsx/dist/cli.mjs');
  /** A process that migrates the file and opens it through the app's own client (tests/local/holder.ts). */
  function startHolder(local: LocalDatabase) {
    const child = spawn(process.execPath, [tsx, path.join(__dirname, 'holder.ts'), local.file, local.keyHex, local.sqlDir], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const settled = new Promise<string>((resolve) => {
      child.stdout.on('data', (chunk) => { output += String(chunk); if (/READY|REFUSED/.test(output)) resolve(output.trim()); });
      child.stderr.on('data', (chunk) => { output += String(chunk); });
      child.once('exit', (code) => resolve(`${output.trim()} (exited ${code})`));
    });
    return { child, settled };
  }

  it('a second process is refused while the first holds the data folder, and opens it once the first is gone', async () => {
    const local = localPaths();
    cleanups.push(() => local.remove());
    const first = startHolder(local);
    cleanups.push(() => first.child.kill());
    expect(await first.settled).toMatch(/^READY/);

    const second = startHolder(local);
    cleanups.push(() => second.child.kill());
    expect(await second.settled).toMatch(/REFUSED \[local\] another LexCraft process has this data folder open/);
    expect(() => migrateLocal(local)).toThrow(/another LexCraft process has this data folder open/);

    // The operating system's exclusion, twenty times over: a plain process trying the lock file's write lock.
    const driver = path.dirname(require.resolve('better-sqlite3/package.json'));
    const attempt = `const D=require(${JSON.stringify(driver)});const d=new D(${JSON.stringify(`${local.file}.lock`)});d.pragma('busy_timeout=0');`
      + `try{d.pragma('locking_mode=EXCLUSIVE');d.prepare('INSERT OR REPLACE INTO "holder" ("id","pid","since") VALUES (1,0,?)').run('x');console.log('TOOK')}`
      + `catch(e){console.log('REFUSED '+e.message)}finally{d.close()}`;
    for (let i = 0; i < 20; i++) {
      expect(execFileSync(process.execPath, ['-e', attempt]).toString().trim()).toMatch(/^REFUSED .*database is locked/);
    }

    const exited = new Promise((resolve) => first.child.once('exit', resolve));
    first.child.stdin.end();
    await exited;
    expect(migrateLocal(local)).toEqual({ created: false, applied: [], backup: null });
    const after = open(local);
    expect(after.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 });
    after.close();
  }, 30_000);
});
