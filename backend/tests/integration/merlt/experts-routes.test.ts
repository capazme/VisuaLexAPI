import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import nock from 'nock';
import { request, app, createTestUser, authHeader, type TestUser } from '../../helpers';
import { _resetExpertsClientForTests } from '../../../src/services/merlt/expertsClient';

const TEST_MERLT_BASE = 'http://experts-test.local:8000';

beforeAll(() => {
  process.env.MERLT_API_URL = TEST_MERLT_BASE;
  process.env.MERLT_EXPERTS_TIMEOUT_MS = '500';
  _resetExpertsClientForTests();
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
  nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
});
afterEach(() => nock.cleanAll());
afterAll(() => {
  nock.enableNetConnect();
  nock.restore();
  delete process.env.MERLT_API_URL;
  delete process.env.MERLT_EXPERTS_TIMEOUT_MS;
});

async function grantFull(user: TestUser): Promise<void> {
  await request(app).post('/api/merlt/consent').set(authHeader(user)).send({ level: 'full' });
}

async function grantBasic(user: TestUser): Promise<void> {
  await request(app).post('/api/merlt/consent').set(authHeader(user)).send({ level: 'basic' });
}

const QUERY_OK = {
  trace_id: 'trace_abc',
  synthesis: 'La risoluzione...',
  mode: 'convergent',
  sources: [],
  retrieved_sources: [{ urn: 'urn:nir:..~art1453', provenance: 'seed', trust: 1, node_id: 'urn:nir:..~art1453' }],
  experts_used: ['literal', 'precedent'],
  confidence: 0.55,
  execution_time_ms: 1234,
};

describe('MERL-T experts routes (Loop β Phase F)', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('experts-alice');
  });

  it('401 without auth', async () => {
    const res = await request(app).post('/api/merlt/experts/query').send({ query: 'art 1453 risoluzione' });
    expect(res.status).toBe(401);
  });

  it('403 without any consent (asking needs at least basic — Slice 3 D2)', async () => {
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione' });
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('consent_required');
  });

  it('basic consent CAN ask (asking is consumption, not contribution — Slice 3 D2)', async () => {
    await grantBasic(user);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/query', (b) => (b as { consent_level: string }).consent_level === 'basic')
      .reply(200, QUERY_OK);
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione' });
    expect(res.status).toBe(200);
    expect(res.body.trace_id).toBe('trace_abc');
  });

  it('400 on too-short query', async () => {
    await grantFull(user);
    const res = await request(app).post('/api/merlt/experts/query').set(authHeader(user)).send({ query: 'q' });
    expect(res.status).toBe(400);
  });

  it('proxies the query, injects user_id + consent_level=full, returns provenance-tagged sources', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/query', (b) => {
        const body = b as { query: string; user_id: string; consent_level: string; include_trace: boolean };
        return (
          body.query === 'art 1453 risoluzione' &&
          body.user_id === user.id &&
          body.consent_level === 'full' &&
          body.include_trace === true
        );
      })
      .reply(200, QUERY_OK);
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione', mode: 'convergent' });
    expect(res.status).toBe(200);
    expect(res.body.trace_id).toBe('trace_abc');
    expect(res.body.retrieved_sources[0].provenance).toBe('seed');
  });

  it('503 when MERL-T is unavailable (5xx)', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).post('/api/v1/experts/query').reply(502, 'down');
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione' });
    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });

  it('passes through a MERL-T 4xx', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).post('/api/v1/experts/query').reply(422, { detail: 'query too short upstream' });
    const res = await request(app)
      .post('/api/merlt/experts/query')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione' });
    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('query too short upstream');
  });

  it('confirm-source forwards node_id + injected user_id', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/enrichment/confirm-source', (b) => {
        const body = b as { node_id: string; user_id: string };
        return body.node_id === 'live:abc123' && body.user_id === user.id;
      })
      .reply(200, { node_id: 'live:abc123', pending_entity_id: 42 });
    const res = await request(app)
      .post('/api/merlt/experts/confirm-source')
      .set(authHeader(user))
      .send({ nodeId: 'live:abc123' });
    expect(res.status).toBe(200);
    expect(res.body.pending_entity_id).toBe(42);
  });

  it('rejects a non-provisional confirm-source node id (400)', async () => {
    await grantFull(user);
    const res = await request(app)
      .post('/api/merlt/experts/confirm-source')
      .set(authHeader(user))
      .send({ nodeId: 'urn:nir:..~art1453' });
    expect(res.status).toBe(400);
  });

  it('inline feedback forwards rating + user_id', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/feedback/inline', (b) => {
        const body = b as { trace_id: string; user_id: string; rating: number };
        return body.trace_id === 'trace_abc' && body.user_id === user.id && body.rating === 5;
      })
      .reply(200, { success: true, feedback_id: 1, message: 'ok' });
    const res = await request(app)
      .post('/api/merlt/experts/feedback/inline')
      .set(authHeader(user))
      .send({ traceId: 'trace_abc', rating: 5 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('history forwards user_id + clamped limit and returns the list', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .get('/api/v1/experts/history')
      .query((q) => q.user_id === user.id && q.limit === '20')
      .reply(200, [
        { trace_id: 'trace_x', query: 'art 1453?', synthesis: 'La risoluzione…', mode: 'convergent', confidence: 0.6, experts_used: ['literal'], sources: [], created_at: '2026-05-31T10:00:00Z' },
      ]);
    const res = await request(app).get('/api/merlt/experts/history').set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body[0].trace_id).toBe('trace_x');
  });

  it('history requires at least basic consent (403 when none)', async () => {
    const res = await request(app).get('/api/merlt/experts/history').set(authHeader(user));
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('consent_required');
  });

  it('preference feedback (divergent) forwards preferred_expert', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/feedback/preference', (b) => (b as { preferred_expert: string }).preferred_expert === 'systemic')
      .reply(200, { success: true, message: 'ok' });
    const res = await request(app)
      .post('/api/merlt/experts/feedback/preference')
      .set(authHeader(user))
      .send({ traceId: 'trace_abc', preferredExpert: 'systemic' });
    expect(res.status).toBe(200);
  });
});
