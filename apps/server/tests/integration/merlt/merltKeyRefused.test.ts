import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import nock from 'nock';
import { request, app, createTestUser, authHeader, prisma, type TestUser, merltNoticeId } from '../../helpers';
import { _resetMerltClientForTests } from '../../../src/routes/merlt/events';
import { _resetGraphClientForTests, _resetSubgraphCacheForTests } from '../../../src/routes/merlt/graph';
import { _resetOpsClientForTests } from '../../../src/routes/merlt/ops';

/**
 * When MERL-T refuses the server's key (401 or 403: MERLT_API_KEY missing, or different from the key
 * MERL-T seeded), the server answers 503 `merlt_auth_misconfigured`: a fault of its own configuration,
 * never the person's. A 401 relayed to the browser would read as an expired session there: the web
 * would spend a token refresh on every refused call, and refreshes are capped per address.
 */
const TEST_MERLT_BASE = 'http://merlt-test.local:8000';

beforeAll(() => {
  process.env.MERLT_API_URL = TEST_MERLT_BASE;
  process.env.MERLT_TIMEOUT_MS = '500';
  process.env.MERLT_API_KEY = 'a-key-merlt-does-not-know';
  _resetMerltClientForTests();
  _resetGraphClientForTests();
  _resetOpsClientForTests();
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
  nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
});

beforeEach(() => {
  _resetSubgraphCacheForTests();
});

afterEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  nock.enableNetConnect();
  nock.restore();
  delete process.env.MERLT_API_URL;
  delete process.env.MERLT_TIMEOUT_MS;
  delete process.env.MERLT_API_KEY;
});

async function grantConsent(user: TestUser): Promise<void> {
  await request(app)
    .post('/api/merlt/consent')
    .set(authHeader(user))
    .send({ level: 'basic', noticeId: await merltNoticeId() });
}

const refusal = { detail: 'API key required' };

describe.each([401, 403])('MERL-T answers %i to the server', (status) => {
  it('a tracked reading is a 503 for the server, not a 4xx for the person', async () => {
    const user = await createTestUser(`refused-event-${status}`);
    await grantConsent(user);
    nock(TEST_MERLT_BASE).get('/api/v1/profile/full').query(true).reply(status, refusal);
    nock(TEST_MERLT_BASE).post('/api/v1/tracking/events').reply(status, refusal);

    const res = await request(app)
      .post('/api/merlt/events/article-viewed')
      .set(authHeader(user))
      .send({
        articleUrn: 'urn:nir:stato:codice.civile:1942;2043',
        dwellMs: 4500,
        scrollMaxPct: 60,
        sessionId: '00000000-0000-0000-0000-000000000001',
      });

    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_auth_misconfigured');
  });

  it('a graph read is a 503 for the server', async () => {
    const user = await createTestUser(`refused-graph-${status}`);
    await grantConsent(user);
    const urn = 'urn:nir:stato:codice.civile:1942;2043';
    nock(TEST_MERLT_BASE).get('/api/v1/graph/subgraph').query(true).reply(status, refusal);

    const res = await request(app).get(`/api/merlt/graph/article/${encodeURIComponent(urn)}`).set(authHeader(user));

    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_auth_misconfigured');
  });

  it('the profile, with nothing cached, is a 503 for the server', async () => {
    const user = await createTestUser(`refused-profile-${status}`);
    await grantConsent(user);
    nock(TEST_MERLT_BASE).get('/api/v1/profile/full').query(true).reply(status, refusal);

    const res = await request(app).get('/api/merlt/profile').set(authHeader(user));

    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_auth_misconfigured');
  });

  it('an admin setting is a 503 for the server, not relayed to the admin', async () => {
    const user = await createTestUser(`refused-ops-${status}`);
    await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
    nock(TEST_MERLT_BASE).put('/api/v1/admin/config/synthesis_model').reply(status, refusal);

    const res = await request(app)
      .put('/api/merlt/ops/config/synthesis_model')
      .set(authHeader(user))
      .send({ value: 'anthropic/claude-sonnet-4.5' });

    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_auth_misconfigured');
  });
});
