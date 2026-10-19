// apps/server/tests/integration/merlt/rassegne-routes.test.ts
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { app, authHeader, createTestUser, request } from '../../helpers';
import { _resetRassegneClientForTests } from '../../../src/routes/merlt/rassegne';

const BASE = 'http://merlt-test.local:8000';
const URN = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043';
const EMPTY = { urn: URN, total: 0, anni: [], archivi: [], anno: null, items: [], next_cursor: null };

describe('GET /api/merlt/rassegne', () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(() => {
    process.env.MERLT_API_URL = BASE;
    process.env.MERLT_TIMEOUT_MS = '500';
    process.env.MERLT_API_KEY = 'test-rassegne-key';
    _resetRassegneClientForTests();
    if (!nock.isActive()) nock.activate();
    nock.disableNetConnect();
    nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
  });
  beforeEach(async () => {
    user = await createTestUser('rassegne-reader');
  });
  afterEach(() => nock.cleanAll());

  it('normalises version markers before calling MERL-T', async () => {
    let apiKey: string | undefined;
    nock(BASE)
      .get('/api/v1/rassegne/by-norma')
      .query((q) => q.urn === URN && q.anno === '2024' && q.archivio === 'civile' && q.cursor === '10')
      .reply(function () {
        apiKey = this.req.headers['x-api-key'] as string | undefined;
        return [200, EMPTY];
      });
    const res = await request(app)
      .get('/api/merlt/rassegne')
      .query({ urn: `${URN}!vig=2020-01-01`, anno: 2024, archivio: 'civile', cursor: '10' })
      .set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(EMPTY);
    expect(apiKey).toBe('test-rassegne-key');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/merlt/rassegne').query({ urn: URN });
    expect(res.status).toBe(401);
  });

  it.each([
    [{}],
    [{ urn: URN, archivio: 'misto' }],
    [{ urn: URN, cursor: 'abc' }],
    [{ urn: URN, anno: '20x4' }],
    [{ urn: 'x'.repeat(501) }],
  ])('rejects a bad query %j', async (query) => {
    const res = await request(app).get('/api/merlt/rassegne').query(query).set(authHeader(user));
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('invalid_query');
  });

  it('maps a network failure to 503', async () => {
    nock(BASE).get('/api/v1/rassegne/by-norma').query(true).replyWithError({ code: 'ECONNREFUSED', message: 'down' });
    const res = await request(app).get('/api/merlt/rassegne').query({ urn: URN }).set(authHeader(user));
    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });

  it('never lets an upstream 401 through', async () => {
    nock(BASE).get('/api/v1/rassegne/by-norma').query(true).reply(401, { detail: 'bad key' });
    const res = await request(app).get('/api/merlt/rassegne').query({ urn: URN }).set(authHeader(user));
    expect(res.status).toBe(503);
  });
});
