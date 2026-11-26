import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma-local/client';
import { localAdapter, releaseInstanceLock } from '../../src/local/database';
import { migrateLocal, type LocalPaths } from '../../src/local/migrate';

/** The local SQL shipped with the server: prisma/local (init.sql, migrations/). */
export const SQL_DIR = path.resolve(__dirname, '../../prisma/local');

export type LocalDatabase = LocalPaths & { dir: string; remove: () => void };

/** A temporary folder with a key generated for the test; the file is made by migrateLocal. */
export function localPaths(sqlDir = SQL_DIR): LocalDatabase {
  const dir = mkdtempSync(path.join(tmpdir(), 'lexcraft-local-'));
  return {
    dir,
    file: path.join(dir, 'lexcraft.db'),
    keyHex: randomBytes(32).toString('hex'),
    sqlDir,
    backupsDir: path.join(dir, 'backups'),
    remove: () => {
      releaseInstanceLock(path.join(dir, 'lexcraft.db'));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The app's own client on that file: the encrypted adapter, configured, serialized. */
export function localClient(paths: LocalPaths): PrismaClient {
  return new PrismaClient({ adapter: localAdapter({ file: paths.file, keyHex: paths.keyHex }) });
}

/** A migrated file and its client. */
export function newLocalDatabase(): LocalDatabase & { prisma: PrismaClient } {
  const paths = localPaths();
  migrateLocal(paths);
  return { ...paths, prisma: localClient(paths) };
}
