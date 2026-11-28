import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

/**
 * The suite on the desktop app's encrypted local file (`LEXCRAFT_TEST_DB=local`, spec §8), the twin of the run's own
 * Postgres database:
 * - once per run (`tests/globalSetup.ts`), a temporary folder under the system's temp folder, a random key, and a
 *   template file migrated by the app's own `migrateLocal`;
 * - in every test file (`tests/setup.ts`), a copy of the template of its own, opened by the app's own local client
 *   (`src/lib/prisma` is replaced by it), and its tables emptied before each test.
 * The folder goes at the end of the run. The key exists only for the run; nothing logs it.
 */
export type LocalRun = {
  dir: string;
  keyHex: string;
  template: string;
  /** The tables a test may write: every table but SQLite's own and the local mode's (`_lexcraft_*`). */
  tables: string[];
  /** A digest of the schema the migrations made, checked by every file as the Postgres fingerprint is. */
  schema: string;
};

export const isLocalRun = (): boolean => process.env.LEXCRAFT_TEST_DB === 'local';

const SQL_DIR = path.resolve(__dirname, '../prisma/local');
const SCHEMA_ROWS = `SELECT "name", "type", "sql" FROM "sqlite_master" WHERE "type" IN ('table', 'index') AND "name" NOT LIKE 'sqlite_%' ORDER BY "name"`;

/** The guard's twin (`assertTestDatabase`): a local test file sits under the system's temp folder, nowhere else. */
export function assertLocalTestFile(file: string): void {
  const temp = realpathSync(tmpdir());
  const real = path.join(realpathSync(path.dirname(file)), path.basename(file));
  if (!real.startsWith(temp + path.sep)) {
    throw new Error(`Refusing to run tests: the local test file ${file} is not under the temp folder ${temp}.`);
  }
}

export function schemaDigest(rows: Array<{ name: string; type: string; sql: string | null }>): string {
  return createHash('sha256').update(rows.map((row) => `${row.type} ${row.name} ${row.sql ?? ''}`).join('\n')).digest('hex');
}

export { SCHEMA_ROWS };

/** Once per run: the folder, the key and the migrated template. */
export async function createLocalRun(): Promise<{ run: LocalRun; remove: () => void }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'lexcraft-test-run-'));
  // Retried: on Windows a file a process has just let go can still be busy for a moment.
  const remove = () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  try {
    const template = path.join(dir, 'template.db');
    assertLocalTestFile(template);
    const keyHex = randomBytes(32).toString('hex');
    const { migrateLocal } = await import('../src/local/migrate');
    const { applyKey, releaseInstanceLock } = await import('../src/local/database');
    migrateLocal({ file: template, keyHex, sqlDir: SQL_DIR, backupsDir: path.join(dir, 'backups') });
    releaseInstanceLock(template);

    const { default: Database } = await import('better-sqlite3');
    const db = new Database(template);
    let rows: Array<{ name: string; type: string; sql: string | null }>;
    try {
      applyKey(db, keyHex);
      rows = db.prepare(SCHEMA_ROWS).all() as typeof rows;
    } finally {
      db.close();
    }
    const tables = rows.filter((row) => row.type === 'table' && !row.name.startsWith('_lexcraft_')).map((row) => row.name);
    return { run: { dir, keyHex, template, tables, schema: schemaDigest(rows) }, remove };
  } catch (error) {
    remove();
    throw error;
  }
}

/** In a test file: a copy of the template of its own, under the run's folder. */
export function localFileFor(run: LocalRun): string {
  const file = path.join(run.dir, `file-${process.pid}-${randomBytes(4).toString('hex')}.db`);
  assertLocalTestFile(file);
  copyFileSync(run.template, file);
  return file;
}

/** `tests/local/work-files.txt`: the Work test files the local job runs, and the ones it does not, each with why. */
export const WORK_FILES = path.resolve(__dirname, 'local/work-files.txt');
/** `tests/local/skips.txt`: single tests of those files that cannot run on the local file in M1, under their reason. */
export const SKIPS = path.resolve(__dirname, 'local/skips.txt');

const lines = (file: string): string[] => readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.trim());

export function workFiles(): { run: string[]; notRun: Array<{ file: string; reason: string }> } {
  const run: string[] = [];
  const notRun: Array<{ file: string; reason: string }> = [];
  for (const line of lines(WORK_FILES)) {
    const skipped = /^# not run: (\S+) — (.+)$/.exec(line);
    if (skipped) notRun.push({ file: skipped[1], reason: skipped[2] });
    else if (line && !line.startsWith('#')) run.push(line);
  }
  return { run, notRun };
}

/** Each skipped test's full name, as vitest prints it (`<file> > <describe> > <test>`), with its reason. */
export function localSkips(): Map<string, string> {
  const skips = new Map<string, string>();
  let reason = '';
  for (const line of lines(SKIPS)) {
    if (!line || line.startsWith('#')) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) reason = header[1];
    else if (!reason) throw new Error(`tests/local/skips.txt: "${line}" has no reason above it`);
    else skips.set(line, reason);
  }
  return skips;
}

type TaskLike = { name: string; suite?: TaskLike; file?: { name: string } };

/** A test's full name as vitest prints it. */
export function fullName(task: TaskLike): string {
  const file = task.file?.name ?? '';
  const names: string[] = [];
  for (let at: TaskLike | undefined = task; at; at = at.suite) if (at.name && at.name !== file) names.unshift(at.name);
  return [file, ...names].join(' > ');
}
