#!/usr/bin/env node
// PreToolUse hook (Bash), shared by everyone who opens this repository with
// Claude Code: the git flow and the database rules of docs/git-workflow.md.
// GitHub enforces the branch rules too; this says so before the round trip.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROTECTED = ['main', 'develop'];

// migrate dev offers to reset a drifted database, and an agent can accept.
const MIGRATE = /\bprisma\s+migrate\s+(dev|reset)\b/;
const FORCE_RESET = /\bprisma\s+db\s+push\b[^;&|]*--force-reset/;
// The same two through apps/server/package.json's scripts.
const MIGRATE_SCRIPT = /\b(npm|pnpm|yarn|bun)\b[^;&|]*\bprisma:(migrate|reset)\b/;

function segments(command) {
  return command.split(/&&|\|\||;|\||\n/).map((s) => s.trim()).filter(Boolean);
}

function gitCall(tokens) {
  if (tokens[0] !== 'git') return null;
  let i = 1;
  let dir = null;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    if (tokens[i] === '-C') { dir = tokens[i + 1]; i += 2; continue; }
    if (tokens[i] === '-c') { i += 2; continue; }
    i += 1;
  }
  return { sub: tokens[i], args: tokens.slice(i + 1), dir };
}

function pushTargets(args, branch) {
  const flags = args.filter((a) => a.startsWith('-'));
  if (flags.includes('--all') || flags.includes('--mirror')) return PROTECTED;
  const refspecs = args.filter((a) => !a.startsWith('-')).slice(1); // [0] is the remote
  if (refspecs.length === 0) {
    const onlyTagsOrDelete = flags.includes('--tags') || flags.includes('--delete') || flags.includes('-d');
    return onlyTagsOrDelete ? [] : [branch];
  }
  return refspecs.map((spec) => {
    const s = spec.replace(/^\+/, '');
    const dst = (s.includes(':') ? s.split(':')[1] : s).replace(/^refs\/heads\//, '');
    return dst === 'HEAD' ? branch : dst;
  });
}

export function decide(command, branchOf) {
  for (const segment of segments(command)) {
    if (MIGRATE.test(segment) || FORCE_RESET.test(segment) || MIGRATE_SCRIPT.test(segment)) {
      return 'prisma migrate dev/reset and db push --force-reset can wipe the development database. '
        + 'Write the migration by hand and apply it with `npx prisma migrate deploy` (apps/server/CLAUDE.md).';
    }
    const call = gitCall(segment.split(/\s+/));
    if (!call) continue;
    const branch = branchOf(call.dir);
    // Another repository: its main is not ours to guard, whether the command
    // names it (`git push origin main`) or not.
    if (branch === null) continue;
    if (call.sub === 'commit' && !call.args.includes('--dry-run') && PROTECTED.includes(branch)) {
      return `Commits do not go on ${branch}: create a branch from develop (feat/, fix/, refactor/, chore/, docs/) `
        + 'and open a pull request (docs/git-workflow.md).';
    }
    if (call.sub === 'push') {
      const hit = pushTargets(call.args, branch).find((target) => PROTECTED.includes(target));
      if (hit) return `Nothing is pushed to ${hit} directly: it changes only through a pull request (docs/git-workflow.md).`;
    }
  }
  return null;
}

function git(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// The repository a directory belongs to, as its common git dir: the same for
// the main checkout and every worktree. '' outside a repository.
export function commonDir(dir) {
  const out = git(dir, ['rev-parse', '--git-common-dir']);
  if (!out) return '';
  try {
    return realpathSync(path.resolve(dir, out));
  } catch {
    return '';
  }
}

const OWN_REPO = commonDir(path.dirname(fileURLToPath(import.meta.url)));

// The branch a git command acts on, but only inside this repository: a
// session may also commit to another repository on the same disk, whose main
// is not ours to guard. Another repository (or none) resolves to null, and
// decide() then applies no git rule at all; '' means this repository, branch
// unknown.
export function branchResolver(cwd, ownRepo = OWN_REPO) {
  return (dir) => {
    const target = dir ? path.resolve(cwd, dir) : cwd;
    if (!ownRepo || commonDir(target) !== ownRepo) return null;
    return git(target, ['rev-parse', '--abbrev-ref', 'HEAD']);
  };
}

function main() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const reason = decide(input?.tool_input?.command ?? '', branchResolver(input?.cwd ?? process.cwd()));
  if (reason) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }));
  }
}

// Node resolves the entry module through symlinks (macOS /var is one), so
// compare real paths: a mismatch would silently turn the hook off.
function isEntryPoint() {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (process.argv[1] && isEntryPoint()) main();
