import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import nock from 'nock';
import {
  request,
  app,
  createTestUser,
  authHeader,
  prisma,
  type TestUser,
} from '../../helpers';
import { _resetMerltClientForTests } from '../../../src/routes/merlt/events';

const TEST_MERLT_BASE = 'http://merlt-test.local:8000';

beforeAll(() => {
  process.env.MERLT_API_URL = TEST_MERLT_BASE;
  process.env.MERLT_TIMEOUT_MS = '500';
  _resetMerltClientForTests();
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
  // Allow supertest to talk to the in-process Express app on 127.0.0.1
  nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
});

afterEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  nock.enableNetConnect();
  nock.restore();
  delete process.env.MERLT_API_URL;
  delete process.env.MERLT_TIMEOUT_MS;
});

async function grantConsent(user: TestUser, level: 'basic' | 'full' = 'basic'): Promise<void> {
  await request(app)
    .post('/api/merlt/consent')
    .set(authHeader(user))
    .send({ level });
}

const validPayload = {
  articleUrn: 'urn:nir:stato:codice.civile:1942;2043',
  dwellMs: 4500,
  scrollMaxPct: 60,
  sessionId: '00000000-0000-0000-0000-000000000001',
};

describe('POST /api/merlt/events/article-viewed (MERLT-1.5)', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser('events-alice');
  });

  it('returns 202 + trace_id when consent=basic and MERL-T accepts', async () => {
    await grantConsent(user, 'basic');

    // MERL-T profile lookup (authority cache miss) — let it 503 to test
    // graceful degradation: event should still be sent without user_authority
    nock(TEST_MERLT_BASE).get('/api/profile/full').query(true).reply(503);

    nock(TEST_MERLT_BASE)
      .post('/api/tracking/event', (body: unknown) => {
        const b = body as Record<string, unknown>;
        return (
          b.event_type === 'article_viewed' &&
          b.user_id === user.id &&
          b.article_urn === validPayload.articleUrn &&
          b.dwell_ms === 4500 &&
          b.scroll_max_pct === 60
        );
      })
      .reply(200, { trace_id: 'trace-test-001' });

    const res = await request(app)
      .post('/api/merlt/events/article-viewed')
      .set(authHeader(user))
      .send(validPayload);

    expect(res.status).toBe(202);
    expect(res.body.trace_id).toBe('trace-test-001');
  });

  it('attaches user_authority from cache when available', async () => {
    await grantConsent(user, 'full');

    // Pre-warm authority cache directly
    await prisma.merltUserAuthorityCache.create({
      data: {
        userId: user.id,
        authorityScore: 0.72,
        baselineQual: 'avvocato',
        trackRecord: 0.8,
        performance: 0.6,
        totalContributions: 15,
      },
    });

    nock(TEST_MERLT_BASE)
      .post('/api/tracking/event', (body: unknown) => {
        const b = body as Record<string, unknown>;
        return (
          b.user_authority === 0.72 &&
          b.baseline_qualification === 'avvocato'
        );
      })
      .reply(200, { trace_id: 'trace-test-002' });

    const res = await request(app)
      .post('/api/merlt/events/article-viewed')
      .set(authHeader(user))
      .send(validPayload);

    expect(res.status).toBe(202);
  });

  it('returns 403 consent_required when user has not granted consent', async () => {
    // No consent set → consentLevel default = 'none' (no preference row)
    const res = await request(app)
      .post('/api/merlt/events/article-viewed')
      .set(authHeader(user))
      .send(validPayload);

    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('consent_required');
  });

  it('returns 403 consent_required when consent revoked (level=none)', async () => {
    await grantConsent(user, 'basic');
    await request(app).delete('/api/merlt/consent').set(authHeader(user));

    const res = await request(app)
      .post('/api/merlt/events/article-viewed')
      .set(authHeader(user))
      .send(validPayload);

    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('consent_required');
  });

  it('returns 503 merlt_unavailable when MERL-T sidecar is down', async () => {
    await grantConsent(user, 'basic');
    nock(TEST_MERLT_BASE).get('/api/profile/full').query(true).reply(503);
    nock(TEST_MERLT_BASE)
      .post('/api/tracking/event')
      .replyWithError({ code: 'ECONNREFUSED', message: 'connection refused' });

    const res = await request(app)
      .post('/api/merlt/events/article-viewed')
      .set(authHeader(user))
      .send(validPayload);

    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });

  it('returns 503 when MERL-T responds 5xx', async () => {
    await grantConsent(user, 'basic');
    nock(TEST_MERLT_BASE).get('/api/profile/full').query(true).reply(503);
    nock(TEST_MERLT_BASE).post('/api/tracking/event').reply(500, 'internal error');

    const res = await request(app)
      .post('/api/merlt/events/article-viewed')
      .set(authHeader(user))
      .send(validPayload);

    expect(res.status).toBe(503);
  });

  it('returns 400 pass-through when MERL-T rejects payload', async () => {
    await grantConsent(user, 'basic');
    nock(TEST_MERLT_BASE).get('/api/profile/full').query(true).reply(503);
    nock(TEST_MERLT_BASE)
      .post('/api/tracking/event')
      .reply(400, { detail: 'unknown event_type' });

    const res = await request(app)
      .post('/api/merlt/events/article-viewed')
      .set(authHeader(user))
      .send(validPayload);

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('merlt_rejected');
    expect(res.body.upstream).toEqual({ detail: 'unknown event_type' });
  });

  it('returns 400 when payload fails Zod validation', async () => {
    await grantConsent(user, 'basic');
    const res = await request(app)
      .post('/api/merlt/events/article-viewed')
      .set(authHeader(user))
      .send({ articleUrn: '', dwellMs: -1, scrollMaxPct: 200, sessionId: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('invalid_body');
    expect(res.body.issues).toBeDefined();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post('/api/merlt/events/article-viewed')
      .send(validPayload);

    expect(res.status).toBe(401);
  });

  it('normalizes -bis URN suffixes in the outgoing payload', async () => {
    await grantConsent(user, 'basic');
    nock(TEST_MERLT_BASE).get('/api/profile/full').query(true).reply(503);

    nock(TEST_MERLT_BASE)
      .post('/api/tracking/event', (body: unknown) => {
        const b = body as Record<string, unknown>;
        return b.article_urn === 'urn:nir:stato:codice.civile:1942;2043-bis';
      })
      .reply(200, { trace_id: 't-bis' });

    const res = await request(app)
      .post('/api/merlt/events/article-viewed')
      .set(authHeader(user))
      .send({
        ...validPayload,
        articleUrn: 'urn:nir:stato:codice.civile:1942;2043 bis', // space-form input
      });

    expect(res.status).toBe(202);
  });
});

describe('GET /api/merlt/health (MERLT-1.5)', () => {
  it('returns 200 with merlt=reachable when MERL-T responds', async () => {
    nock(TEST_MERLT_BASE).get('/health').reply(200, { status: 'ok' });

    const res = await request(app).get('/api/merlt/health');
    expect(res.status).toBe(200);
    expect(res.body.merlt).toBe('reachable');
    expect(res.body.upstream).toEqual({ status: 'ok' });
  });

  it('returns 503 with merlt=unreachable when MERL-T is down', async () => {
    nock(TEST_MERLT_BASE)
      .get('/health')
      .replyWithError({ code: 'ECONNREFUSED', message: 'connection refused' });

    const res = await request(app).get('/api/merlt/health');
    expect(res.status).toBe(503);
    expect(res.body.merlt).toBe('unreachable');
  });
});

describe('GET /api/merlt/profile (MERLT-1.5)', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser('profile-bob');
  });

  it('returns cached authority when MERL-T sync is unavailable', async () => {
    await prisma.merltUserAuthorityCache.create({
      data: {
        userId: user.id,
        authorityScore: 0.5,
        baselineQual: 'studente',
        trackRecord: 0.4,
        performance: 0.3,
        totalContributions: 5,
      },
    });

    nock(TEST_MERLT_BASE).get('/api/profile/full').query(true).reply(503);

    const res = await request(app)
      .get('/api/merlt/profile')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.authorityScore).toBeCloseTo(0.5);
    expect(res.body.baselineQual).toBe('studente');
  });

  it('returns 503 when cache miss AND MERL-T unreachable', async () => {
    nock(TEST_MERLT_BASE)
      .get('/api/profile/full')
      .query(true)
      .replyWithError({ code: 'ECONNREFUSED', message: 'connection refused' });

    const res = await request(app)
      .get('/api/merlt/profile')
      .set(authHeader(user));

    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });
});
