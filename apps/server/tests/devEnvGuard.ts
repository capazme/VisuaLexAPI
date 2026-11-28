import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The suite's environment is `.env.test` (through `dotenv -e .env.test`) and what the setup
 * assigns, never a development `.env`. Since Prisma 7 (G-612) the generated client loads no `.env`;
 * the one loader left is `dotenv.config()` in `src/config.ts`, which the setup turns off (a mock).
 * The setup still drops, for the families the suite configures, every `OAUTH_*` and `MERLT_*` that
 * `.env.test` does not name, wherever it came from (a shell export too). A development MCP secret once won this way, and every OAuth
 * exchange answered `invalid_client` in the main checkout only. The global setup, in vitest's main
 * process, whose environment the test processes inherit, takes out whatever its imports add
 * (`dropAddedSince`, `tests/globalSetup.ts`).
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
 * Deletes every variable that appeared since `before` was taken. Prisma 5's own dotenv used to add
 * the names a development `.env` had; Prisma 7 adds none, and this stays as the guard. Returns the
 * names dropped.
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
