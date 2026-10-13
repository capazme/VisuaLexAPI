import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The suite's environment is `.env.test` (through `dotenv -e .env.test`) and what the setup
 * assigns, never a development `.env`. Two things can still load `apps/server/.env` into a
 * run: `@prisma/client`, when it was generated in a checkout that has one, and
 * `dotenv.config()` in `src/config.ts`. The setup turns the second off (a mock), wraps the
 * first so that whatever it loads is taken out at once (`dropAddedSince`, at the import and at
 * every construction: `src/lib/prisma.ts` and `tests/helpers.ts` build clients after the setup),
 * and drops, for the families the suite configures, every `OAUTH_*` and `MERLT_*` that
 * `.env.test` does not name, wherever it came from (a shell export too). A development MCP secret once won this way, and every OAuth
 * exchange answered `invalid_client` in the main checkout only.
 */
export const GUARDED = /^(OAUTH|MERLT)_/;

/** The names `.env.test` sets (only the names: its values are never read here). */
export function envTestKeys(file = resolve(process.cwd(), '.env.test')): Set<string> {
  const names = new Set<string>();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const name = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (name) names.add(name);
  }
  return names;
}

/**
 * Deletes every variable that appeared since `before` was taken: what Prisma's own dotenv
 * loaded from a development `.env` (it adds the names that are missing, at import and again
 * at every `new PrismaClient()`). Returns the names dropped.
 */
export function dropAddedSince(before: ReadonlySet<string>, env: NodeJS.ProcessEnv = process.env): string[] {
  const added = Object.keys(env).filter((name) => !before.has(name));
  for (const name of added) delete env[name];
  return added;
}

/** Deletes every guarded variable `.env.test` does not set; returns the names dropped. */
export function dropDevelopmentEnv(env: NodeJS.ProcessEnv = process.env, allowed = envTestKeys()): string[] {
  const dropped = Object.keys(env).filter((name) => GUARDED.test(name) && !allowed.has(name));
  for (const name of dropped) delete env[name];
  return dropped;
}
