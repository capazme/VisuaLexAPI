/**
 * A local migration of the desktop app's database (spec §4 of
 * docs/superpowers/specs/2026-11-26-desktop-local-mode-design.md), after a change to prisma/schema.prisma:
 *
 *   npm run local:schema                 # the new local schema and init.sql
 *   npm run local:migration -- <name>    # prisma/local/migrations/<timestamp>_<name>/migration.sql
 *
 * It diffs the local schema of the last commit against the new one with `prisma migrate diff`, and passes the SQL
 * through scripts/localSql.ts (datetime defaults, the CHECKs of rebuilt tables). Data changes written by hand in a
 * Postgres migration get their SQLite twin in the same folder, by hand, in the same pull request. The app applies
 * the folder at start-up after an encrypted backup (src/local/migrate.ts).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { localSql, parseChecks } from './localSql';
import { LOCAL_CHECKS } from './local-schema';

const SERVER = path.resolve(__dirname, '..');

if (require.main === module) {
  const name = process.argv[2];
  if (!name || !/^[a-z0-9_]+$/.test(name)) throw new Error('usage: npm run local:migration -- <name in [a-z0-9_]>');
  // The local schema the branch started from: the merge base with develop, so a regenerated schema already
  // committed on this branch still yields its migration. Without the remote, the last commit, said aloud.
  const git = (...args: string[]) => execFileSync('git', args, { cwd: SERVER, encoding: 'utf8' }).trim();
  let base = 'HEAD';
  try { base = git('merge-base', 'HEAD', 'origin/develop'); } catch { console.warn('no origin/develop: diffing from the last commit'); }
  console.log(`local schema of ${base.slice(0, 12)} -> the working tree`);
  const previous = git('show', `${base}:./prisma/local/schema.prisma`);
  const dir = mkdtempSync(path.join(tmpdir(), 'local-migration-'));
  try {
    const from = path.join(dir, 'previous.prisma');
    writeFileSync(from, previous);
    const diff = execFileSync('npx', ['prisma', 'migrate', 'diff', '--config', 'prisma.local.config.ts', '--from-schema', from,
      '--to-schema', 'prisma/local/schema.prisma', '--script'], { cwd: SERVER, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (!diff.trim() || /^-- This is an empty migration/m.test(diff)) {
      console.log('the local schema did not change: no migration');
    } else {
      const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
      const folder = path.join(SERVER, 'prisma/local/migrations', `${stamp}_${name}`);
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, 'migration.sql'), localSql(diff, parseChecks(readFileSync(LOCAL_CHECKS, 'utf8')), { migration: true }));
      console.log(`written ${path.relative(SERVER, folder)}/migration.sql`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
