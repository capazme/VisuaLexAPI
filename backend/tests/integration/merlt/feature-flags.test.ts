import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { request, app, createTestUser, authHeader, type TestUser } from '../../helpers';

/**
 * Wave 1 cleanup — config.merlt.enabled / flags.* were defined and read from
 * env but had ZERO call-sites: MERLT_ENABLED=false didn't disable anything.
 * These tests exercise the real kill switch (merltKillSwitch, app.ts) and the
 * per-group gates (featureGate, routes/merlt/index.ts).
 *
 * config.merlt.enabled/flags.* are getters (config.ts) — they read
 * process.env live on every access, so no module reload is needed here: just
 * flip process.env.MERLT_*_ENABLED per test and hit the already-built `app`.
 */
const FLAG_ENV_KEYS = [
  'MERLT_ENABLED',
  'MERLT_GRAPH_ENABLED',
  'MERLT_CONTRIBUTION_ENABLED',
  'MERLT_VALIDATION_ENABLED',
  'MERLT_OPS_ENABLED',
] as const;

let savedEnv: Partial<Record<(typeof FLAG_ENV_KEYS)[number], string>> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of FLAG_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) savedEnv[key] = value;
  }
});

afterEach(() => {
  for (const key of FLAG_ENV_KEYS) {
    const original = savedEnv[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe('MERLT_ENABLED global kill switch', () => {
  it('404s the whole /api/merlt namespace when MERLT_ENABLED=false', async () => {
    process.env.MERLT_ENABLED = 'false';
    const res = await request(app).get('/api/merlt/health');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ detail: 'merlt_disabled' });
  });

  it('mounts /api/merlt/health normally under the test env default (MERLT_ENABLED=true)', async () => {
    const res = await request(app).get('/api/merlt/health');
    expect(res.status).not.toBe(404);
  });

  it('mounts /api/merlt/health normally when MERLT_ENABLED is unset (default = enabled)', async () => {
    delete process.env.MERLT_ENABLED;
    const res = await request(app).get('/api/merlt/health');
    expect(res.status).not.toBe(404);
  });
});

describe('MERLT_GRAPH_ENABLED per-group gate', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser('flag-graph-user');
  });

  it('404s a graph route when MERLT_GRAPH_ENABLED=false, but leaves other groups mounted', async () => {
    process.env.MERLT_GRAPH_ENABLED = 'false';

    const graphRes = await request(app)
      .get('/api/merlt/graph/article/urn%3Anir%3Astato%3Acodice.civile%3A1942%3B2043')
      .set(authHeader(user));
    expect(graphRes.status).toBe(404);
    expect(graphRes.body).toEqual({ detail: 'merlt_disabled' });

    // Unrelated groups must still fall through correctly (the gate is
    // path-scoped, not a blanket 404 for everything reaching that point in
    // the router chain — see featureGate.ts for why that distinction matters).
    const healthRes = await request(app).get('/api/merlt/health');
    expect(healthRes.status).not.toBe(404);

    const consentRes = await request(app).get('/api/merlt/consent').set(authHeader(user));
    expect(consentRes.status).not.toBe(404);
  });

  it('leaves the graph route mounted when MERLT_GRAPH_ENABLED is unset (default = enabled)', async () => {
    delete process.env.MERLT_GRAPH_ENABLED;

    const graphRes = await request(app)
      .get('/api/merlt/graph/article/urn%3Anir%3Astato%3Acodice.civile%3A1942%3B2043')
      .set(authHeader(user));
    expect(graphRes.status).not.toBe(404);
  });
});
