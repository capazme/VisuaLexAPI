import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { branchResolver, commonDir, decide } from './guard.mjs';

// branchOf stub: the current branch, or the branch of a `git -C <dir>` target.
const on = (branch, dirs = {}) => (dir) => (dir ? dirs[dir] ?? branch : branch);

const denied = [
  ['git commit -m x', on('develop')],
  ['git add -A && git commit -m x', on('main')],
  ['git -C /repo commit -m x', on('feat/x', { '/repo': 'main' })],
  ['git push origin main', on('feat/x')],
  ['git push origin HEAD:develop', on('feat/x')],
  ['git push --force origin +feat/x:main', on('feat/x')],
  ['git push', on('develop')],
  ['git push origin HEAD', on('main')],
  ['git push --all origin', on('feat/x')],
  ['git push origin --delete develop', on('feat/x')],
  ['git push origin :main', on('feat/x')],
  ['npx prisma migrate dev --name add_x', on('feat/x')],
  ['cd apps/server && npx prisma migrate reset --force', on('feat/x')],
  ['npx prisma db push --force-reset', on('feat/x')],
  // apps/server/package.json names them prisma:migrate (migrate dev) and prisma:reset.
  ['npm run prisma:migrate', on('feat/x')],
  ['npm --prefix apps/server run prisma:reset', on('feat/x')],
  ['cd apps/server && pnpm run prisma:migrate', on('feat/x')],
  ['yarn prisma:reset', on('feat/x')],
];

const allowed = [
  ['git commit -m x', on('feat/x')],
  ['git commit --dry-run', on('main')],
  ['git push -u origin feat/x', on('feat/x')],
  ['git push --force-with-lease origin feat/x', on('feat/x')],
  ['git push origin v2.0.0', on('develop')],
  ['git push origin --tags', on('develop')],
  ['git log --oneline main..develop', on('develop')],
  ['git switch develop && git pull --ff-only', on('main')],
  ['npx prisma migrate deploy', on('develop')],
  ['npx prisma migrate status', on('develop')],
  ['npm test', on('develop')],
  ['npm run prisma:generate', on('develop')],
  ['npm --prefix apps/server run prisma:studio', on('develop')],
  ['echo "git commit is refused on main"', on('main')],
];

for (const [command, branchOf] of denied) {
  test(`denies: ${command}`, () => assert.ok(decide(command, branchOf)));
}
for (const [command, branchOf] of allowed) {
  test(`allows: ${command}`, () => assert.equal(decide(command, branchOf), null));
}

// Node resolves the entry module through symlinks (macOS /var → /private/var,
// a symlinked checkout): the hook must still run, or it allows everything.
test('runs as a hook when reached through a symlinked path', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  const link = path.join(dir, 'guard.mjs');
  symlinkSync(fileURLToPath(new URL('./guard.mjs', import.meta.url)), link);
  const out = execFileSync(process.execPath, [link], {
    input: JSON.stringify({ tool_input: { command: 'npx prisma migrate dev' }, cwd: dir }),
    encoding: 'utf8',
  });
  assert.match(out, /"permissionDecision":"deny"/);
});

// The git rules guard this repository only: a commit on another repository's
// main (a notes vault, another project) is none of this hook's business.
test('guards the branches of this repository only', () => {
  const other = mkdtempSync(path.join(os.tmpdir(), 'guard-other-'));
  execFileSync('git', ['init', '-q', '-b', 'main', other]);
  const here = fileURLToPath(new URL('.', import.meta.url));
  const own = commonDir(here);
  assert.ok(own, 'the hook sits inside a repository');
  assert.equal(branchResolver(other, own)(), null);
  assert.equal(branchResolver(here, own)(other), null);
  assert.ok(branchResolver(here, own)(), 'a branch name inside this repository');
  assert.equal(decide('git commit -m x', branchResolver(other, own)), null);
  assert.equal(decide(`git -C ${other} commit -m x`, branchResolver(here, own)), null);
  // Naming main explicitly does not make another repository's main ours.
  assert.equal(decide('git push origin main', branchResolver(other, own)), null);
  assert.equal(decide(`git -C ${other} push origin main`, branchResolver(here, own)), null);
  assert.ok(decide('git push origin main', branchResolver(here, own)), 'this repository stays guarded');
});
