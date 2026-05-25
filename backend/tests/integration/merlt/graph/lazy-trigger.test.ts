import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import nock from 'nock';
import {
  request,
  app,
  createTestUser,
  authHeader,
  prisma,
  type TestUser,
} from '../../../helpers';
import {
  _resetMerltClientForTests,
  _resetEventsGraphClientForTests,
} from '../../../../src/routes/merlt/events';

/**
 * MERLT-2a.5 — lazy graph ingestion trigger on `article:viewed`.
 *
 * After the article-viewed event is forwarded to MERL-T, the BFF checks whether
 * the article is in the graph and, if not, idempotently enqueues an ingestion
 * job. The ingestion is opportunistic: a graph-check/enqueue failure must never
 * fail the (P0) tracking event.
 */

const TEST_MERLT_BASE = 'http://merlt-test.local:8000';

beforeAll(() => {
  process.env.MERLT_API_URL = TEST_MERLT_BASE;
  process.env.MERLT_TIMEOUT_MS = '500';
  _resetMerltClientForTests();
  _resetEventsGraphClientForTests();
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
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
  await request(app).post('/api/merlt/consent').set(authHeader(user)).send({ level });
}

function payload(articleUrn: string) {
  return {
    articleUrn,
    dwellMs: 4500,
    scrollMaxPct: 60,
    sessionId: '00000000-0000-0000-0000-000000000001',
  };
}

/** The two best-effort upstreams the article-viewed flow always touches. */
function mockAuthorityAndEvent(times = 1) {
  nock(TEST_MERLT_BASE).get('/api/v1/profile/full').query(true).times(times).reply(503);
  nock(TEST_MERLT_BASE)
    .post('/api/v1/tracking/events')
    .times(times)
    .reply(200, { received: 1, timestamp: '2026-05-25T00:00:00Z' });
}

describe('POST /api/merlt/events/article-viewed lazy graph trigger (MERLT-2a.5)', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser('lazy-alice');
  });

  it('does NOT create a job when the article is already in the graph', async () => {
    await grantConsent(user, 'basic');
    const urn = 'urn:nir:stato:codice.civile:1942;2043';
    mockAuthorityAndEvent();

    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/check-article')
      .query((q) => q.article_urn === urn)
      .reply(200, { exists: true, node_id: 'norma:2043' });

    const res = await request(app)
      .post('/api/merlt/events/article-viewed')
      .set(authHeader(user))
      .send(payload(urn));

    expect(res.status).toBe(202);
    expect(res.body.received).toBe(1);
    expect(res.body.ingestionJob).toBeUndefined();

    const rows = await prisma.merltIngestionJob.findMany({ where: { articleUrn: urn } });
    expect(rows).toHaveLength(0);
  });

  it('creates ONE job and enriches the response when the article is missing', async () => {
    await grantConsent(user, 'basic');
    const urn = 'urn:nir:stato:codice.penale:1930;73';
    mockAuthorityAndEvent();

    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/check-article')
      .query((q) => q.article_urn === urn)
      .reply(200, { exists: false });

    nock(TEST_MERLT_BASE)
      .post('/api/v1/graph/ingest-article', (body: unknown) => {
        const b = body as { urn: string; options?: { bff_job_id?: string } };
        return b.urn === urn && typeof b.options?.bff_job_id === 'string';
      })
      .reply(202, { task_id: 'ingest:lazy1', status: 'queued', urn });

    const res = await request(app)
      .post('/api/merlt/events/article-viewed')
      .set(authHeader(user))
      .send(payload(urn));

    expect(res.status).toBe(202);
    expect(res.body.received).toBe(1);
    expect(res.body.ingestionJob).toBeDefined();
    expect(res.body.ingestionJob.status).toBe('pending');
    expect(typeof res.body.ingestionJob.jobId).toBe('string');

    const rows = await prisma.merltIngestionJob.findMany({ where: { articleUrn: urn } });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(user.id);
    expect(rows[0].taskId).toBe('ingest:lazy1');
    expect(res.body.ingestionJob.jobId).toBe(rows[0].id);
  });

  it('is idempotent: the same missing article viewed 5x creates only ONE job', async () => {
    await grantConsent(user, 'basic');
    const urn = 'urn:nir:stato:codice.penale:1930;575';
    mockAuthorityAndEvent(5);

    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/check-article')
      .query((q) => q.article_urn === urn)
      .times(5)
      .reply(200, { exists: false });

    // Enqueue is reached only on the first view (subsequent views hit the
    // idempotency short-circuit before calling MERL-T).
    nock(TEST_MERLT_BASE)
      .post('/api/v1/graph/ingest-article')
      .reply(202, { task_id: 'ingest:dup', status: 'queued', urn });

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/merlt/events/article-viewed')
        .set(authHeader(user))
        .send(payload(urn));
      expect(res.status).toBe(202);
    }

    const rows = await prisma.merltIngestionJob.findMany({ where: { articleUrn: urn } });
    expect(rows).toHaveLength(1);
  });

  it('still creates the job (taskId null) and enriches the response when the enqueue fails', async () => {
    await grantConsent(user, 'basic');
    const urn = 'urn:nir:stato:codice.civile:1942;1453';
    mockAuthorityAndEvent();

    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/check-article')
      .query((q) => q.article_urn === urn)
      .reply(200, { exists: false });

    // checkArticle succeeds (article missing) but the enqueue POST is down.
    nock(TEST_MERLT_BASE)
      .post('/api/v1/graph/ingest-article')
      .replyWithError({ code: 'ECONNREFUSED', message: 'enqueue down' });

    const res = await request(app)
      .post('/api/merlt/events/article-viewed')
      .set(authHeader(user))
      .send(payload(urn));

    expect(res.status).toBe(202);
    expect(res.body.ingestionJob).toBeDefined();
    expect(res.body.ingestionJob.status).toBe('pending');

    const rows = await prisma.merltIngestionJob.findMany({ where: { articleUrn: urn } });
    expect(rows).toHaveLength(1);
    expect(rows[0].taskId).toBeNull();
  });

  it('accepts the event (202) even when the graph check times out', async () => {
    await grantConsent(user, 'basic');
    const urn = 'urn:nir:stato:codice.civile:1942;2059';
    mockAuthorityAndEvent();

    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/check-article')
      .query(true)
      .replyWithError({ code: 'ECONNREFUSED', message: 'graph down' });

    const res = await request(app)
      .post('/api/merlt/events/article-viewed')
      .set(authHeader(user))
      .send(payload(urn));

    expect(res.status).toBe(202);
    expect(res.body.received).toBe(1);
    expect(res.body.ingestionJob).toBeUndefined();

    const rows = await prisma.merltIngestionJob.findMany({ where: { articleUrn: urn } });
    expect(rows).toHaveLength(0);
  });
});
