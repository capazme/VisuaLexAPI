import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import nock from 'nock';
import { request, app, createTestUser, authHeader, type TestUser } from '../../helpers';
import { _resetExpertsClientForTests } from '../../../src/services/merlt/expertsClient';
import { _resetSteerDedupeForTests } from '../../../src/routes/merlt/experts';

/**
 * Wave 2 — GET /experts/trace/:traceId proxy (review P2.6) + steer idempotency
 * on the 3 teaching channels (review P2.7). Separate file from
 * experts-routes.test.ts to keep the Wave-2 surface self-contained.
 */

const TEST_MERLT_BASE = 'http://experts-wave2-test.local:8000';

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

const TRACE_OK = {
  trace_id: 'trace_hist1',
  query_text: 'art 2043?',
  stages: {
    expert_executions: [
      {
        expert_type: 'literal',
        confidence: 0.8,
        output: { interpretation_preview: 'Tesi…' },
        retrieval_trace: { top_sources: ['urn:x~art2043'] },
      },
    ],
    gating: { weights: { literal: 1 } },
    synthesis: { mode: 'convergent', confidence: 0.8 },
  },
};

const FEEDBACK_OK = { success: true, feedback_id: 7, message: 'ok' };

describe('GET /api/merlt/experts/trace/:traceId (Wave 2 P2.6)', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('trace-alice');
    _resetSteerDedupeForTests();
  });

  it('401 without auth', async () => {
    const res = await request(app).get('/api/merlt/experts/trace/trace_hist1');
    expect(res.status).toBe(401);
  });

  it('403 without any consent (reading a trace is consumption — needs at least basic)', async () => {
    const res = await request(app).get('/api/merlt/experts/trace/trace_hist1').set(authHeader(user));
    expect(res.status).toBe(403);
  });

  it('400 on a malformed trace id', async () => {
    await grantBasic(user);
    const res = await request(app)
      .get('/api/merlt/experts/trace/bad%20id%2F..')
      .set(authHeader(user));
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('invalid_trace_id');
  });

  it('proxies with the CURRENT consent level as caller_consent and strips embedding payloads', async () => {
    await grantBasic(user);
    nock(TEST_MERLT_BASE)
      .get('/api/v1/experts/trace/trace_hist1')
      .query({ caller_consent: 'basic' })
      .reply(200, {
        ...TRACE_OK,
        query_embedding: [0.1, 0.2, 0.3],
        execution_trace: { query_id: 'q1' },
      });
    const res = await request(app).get('/api/merlt/experts/trace/trace_hist1').set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body.trace_id).toBe('trace_hist1');
    expect(res.body.stages.expert_executions).toHaveLength(1);
    // Defence in depth: embeddings/RLCF internals never reach the client.
    expect(res.body.query_embedding).toBeUndefined();
    expect(res.body.execution_trace).toBeUndefined();
  });

  it('404 passthrough when the trace expired / was never stored', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .get('/api/v1/experts/trace/trace_gone')
      .query(true)
      .reply(404, { detail: 'Trace trace_gone not found' });
    const res = await request(app).get('/api/merlt/experts/trace/trace_gone').set(authHeader(user));
    expect(res.status).toBe(404);
  });

  it('503 when MERL-T is unreachable', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .get('/api/v1/experts/trace/trace_hist1')
      .query(true)
      .replyWithError('ECONNREFUSED');
    const res = await request(app).get('/api/merlt/experts/trace/trace_hist1').set(authHeader(user));
    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });
});

describe('steer idempotency on the teaching channels (Wave 2 P2.7)', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('steer-alice');
    await grantFull(user);
    _resetSteerDedupeForTests();
  });

  it('preference: the second identical steer is acknowledged WITHOUT forwarding upstream', async () => {
    const scope = nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/feedback/preference')
      .times(1)
      .reply(200, FEEDBACK_OK);

    const body = { traceId: 'trace_1', preferredExpert: 'literal' };
    const first = await request(app)
      .post('/api/merlt/experts/feedback/preference')
      .set(authHeader(user))
      .send(body);
    expect(first.status).toBe(200);
    expect(first.body.feedback_id).toBe(7);

    // Second identical POST: nock has NO remaining mock and net is disabled —
    // a forward would 503. The 200 deduped response proves no upstream call.
    const second = await request(app)
      .post('/api/merlt/experts/feedback/preference')
      .set(authHeader(user))
      .send(body);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ success: true, deduped: true });
    expect(scope.isDone()).toBe(true);
  });

  it('preference: a DIFFERENT target (canon) is not deduped', async () => {
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/feedback/preference')
      .times(2)
      .reply(200, FEEDBACK_OK);

    const first = await request(app)
      .post('/api/merlt/experts/feedback/preference')
      .set(authHeader(user))
      .send({ traceId: 'trace_1', preferredExpert: 'literal' });
    const second = await request(app)
      .post('/api/merlt/experts/feedback/preference')
      .set(authHeader(user))
      .send({ traceId: 'trace_1', preferredExpert: 'principles' });
    expect(first.body.deduped).toBeUndefined();
    expect(second.body.deduped).toBeUndefined();
    expect(nock.isDone()).toBe(true);
  });

  it('relation: duplicate (trace, relationType) is deduped per user', async () => {
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/feedback/relation')
      .times(1)
      .reply(200, FEEDBACK_OK);

    const body = { traceId: 'trace_1', relationType: 'DISCIPLINA' };
    const first = await request(app)
      .post('/api/merlt/experts/feedback/relation')
      .set(authHeader(user))
      .send(body);
    expect(first.status).toBe(200);
    expect(first.body.feedback_id).toBe(7);

    const second = await request(app)
      .post('/api/merlt/experts/feedback/relation')
      .set(authHeader(user))
      .send(body);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ success: true, deduped: true });

    // Same steer from ANOTHER user forwards (per-user key).
    const other = await createTestUser('steer-bob');
    await grantFull(other);
    nock(TEST_MERLT_BASE).post('/api/v1/experts/feedback/relation').times(1).reply(200, FEEDBACK_OK);
    const otherRes = await request(app)
      .post('/api/merlt/experts/feedback/relation')
      .set(authHeader(other))
      .send(body);
    expect(otherRes.status).toBe(200);
    expect(otherRes.body.deduped).toBeUndefined();
  });

  it('confirm-source: duplicate nodeId is deduped', async () => {
    nock(TEST_MERLT_BASE)
      .post('/api/v1/enrichment/confirm-source')
      .times(1)
      .reply(200, { success: true, node_id: 'live:abc' });

    const body = { nodeId: 'live:abc', entityText: 'Corte Cost. 123/2020' };
    const first = await request(app)
      .post('/api/merlt/experts/confirm-source')
      .set(authHeader(user))
      .send(body);
    expect(first.status).toBe(200);
    expect(first.body.node_id).toBe('live:abc');

    const second = await request(app)
      .post('/api/merlt/experts/confirm-source')
      .set(authHeader(user))
      .send(body);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ success: true, deduped: true });
  });

  it('a FAILED forward is NOT recorded: the retry goes upstream again', async () => {
    nock(TEST_MERLT_BASE).post('/api/v1/experts/feedback/relation').times(1).reply(500, 'boom');
    const body = { traceId: 'trace_1', relationType: 'RINVIA_A' };

    const failed = await request(app)
      .post('/api/merlt/experts/feedback/relation')
      .set(authHeader(user))
      .send(body);
    expect(failed.status).toBe(503);

    nock(TEST_MERLT_BASE).post('/api/v1/experts/feedback/relation').times(1).reply(200, FEEDBACK_OK);
    const retried = await request(app)
      .post('/api/merlt/experts/feedback/relation')
      .set(authHeader(user))
      .send(body);
    expect(retried.status).toBe(200);
    expect(retried.body.feedback_id).toBe(7);
    expect(retried.body.deduped).toBeUndefined();
  });
});
