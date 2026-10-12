import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The suite's environment is `.env.test` (through `dotenv -e .env.test`) and what the setup
 * assigns, never a development `.env`. Two things can still load `apps/server/.env` into a
 * run: `@prisma/client`, when it was generated in a checkout that has one, and
 * `dotenv.config()` in `src/config.ts`. The setup turns the second off (a mock) and drops what
 * the first brought in for the families the suite configures: every `OAUTH_*` and `MERLT_*`
 * that `.env.test` does not name. A development MCP secret once won this way, and every OAuth
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

/** Deletes every guarded variable `.env.test` does not set; returns the names dropped. */
export function dropDevelopmentEnv(env: NodeJS.ProcessEnv = process.env, allowed = envTestKeys()): string[] {
  const dropped = Object.keys(env).filter((name) => GUARDED.test(name) && !allowed.has(name));
  for (const name of dropped) delete env[name];
  return dropped;
}
