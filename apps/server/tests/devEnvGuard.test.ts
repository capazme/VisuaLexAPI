import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import dotenv from 'dotenv';
import { GUARDED, dropDevelopmentEnv, envTestKeys } from './devEnvGuard';

const SETUP_OWN = ['OAUTH_REGISTRATIONS_PER_HOUR', 'OAUTH_REQUESTS_PER_15_MINUTES', 'OAUTH_MCP_CLIENT_SECRET', 'OAUTH_DELEGATION_SECRET'];

describe('the suite keeps a development .env out', () => {
  it('runs with no OAUTH_* or MERLT_* but those .env.test names and the setup assigns', () => {
    const allowed = new Set([...envTestKeys(), ...SETUP_OWN]);
    const foreign = Object.keys(process.env).filter((name) => GUARDED.test(name) && !allowed.has(name));
    expect(foreign).toEqual([]);
  });

  it('turns dotenv.config() into a no-op, so src/config.ts reads nothing more', () => {
    const dir = mkdtempSync(join(tmpdir(), 'devenv-'));
    writeFileSync(join(dir, '.env'), 'MERLT_API_URL=http://dev.invalid\n');
    dotenv.config({ path: join(dir, '.env') });
    expect(process.env.MERLT_API_URL).not.toBe('http://dev.invalid');
  });

  it('drops only the guarded names .env.test does not set, and reads names, not values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'devenv-'));
    const file = join(dir, '.env.test');
    writeFileSync(file, '# comment\nexport MERLT_ENABLED=false\nOAUTH_ISSUER = http://test\nJWT_SECRET=x\n');
    expect([...envTestKeys(file)].sort()).toEqual(['JWT_SECRET', 'MERLT_ENABLED', 'OAUTH_ISSUER']);
    const env: NodeJS.ProcessEnv = { MERLT_ENABLED: 'false', MERLT_API_KEY: 'dev', OAUTH_ISSUER: 'http://test', OAUTH_DAILY_POINTS: '5', REDIS_URL: 'redis://dev' };
    expect(dropDevelopmentEnv(env, envTestKeys(file)).sort()).toEqual(['MERLT_API_KEY', 'OAUTH_DAILY_POINTS']);
    expect(env).toEqual({ MERLT_ENABLED: 'false', OAUTH_ISSUER: 'http://test', REDIS_URL: 'redis://dev' });
  });
});
