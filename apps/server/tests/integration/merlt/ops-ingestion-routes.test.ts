import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import nock from 'nock';
import {
  request,
  app,
  createTestUser,
  authHeader,
  prisma,
  type TestUser,
} from '../../helpers';
import { _resetOpsIngestionClientForTests } from '../../../src/routes/merlt/opsIngestion';

const TEST_MERLT_BASE = 'http://merlt-test.local:8000';

beforeAll(() => {
  process.env.MERLT_API_URL = TEST_MERLT_BASE;
  process.env.MERLT_TIMEOUT_MS = '500';
  process.env.MERLT_API_KEY = 'test-admin-key';
  _resetOpsIngestionClientForTests();
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
  delete process.env.MERLT_API_KEY;
});

async function makeAdmin(user: TestUser): Promise<void> {
  await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
}

describe('POST /api/merlt/ops/ingestion/run', () => {
  it('401s without authentication', async () => {
    const res = await request(app).post('/api/merlt/ops/ingestion/run').send({});
    expect(res.status).toBe(401);
  });

  it('403s admin_required for a non-admin user', async () => {
    const user = await createTestUser('opsing-nonadmin');
    const res = await request(app)
      .post('/api/merlt/ops/ingestion/run')
      .set(authHeader(user))
      .send({ source: 'visualex_tree', source_ref: 'codice-civile', scope_label: 'CC libro IV' });
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('admin_required');
  });

  it('400s on invalid source without calling MERL-T', async () => {
    const user = await createTestUser('opsing-badsrc');
    await makeAdmin(user);

    const res = await request(app)
      .post('/api/merlt/ops/ingestion/run')
      .set(authHeader(user))
      .send({ source: 'not_a_valid_source', source_ref: 'x', scope_label: 'y' });

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('invalid_request');
    // No nock interceptor was registered for this test — if the route had
    // called through to MERL-T, nock would throw "Nock: No match" and the
    // request would fail with a network error, not a clean 400.
  });

  it('proxies to MERL-T, injects created_by, ignores a client-supplied created_by, and returns 202', async () => {
    const user = await createTestUser('opsing-admin');
    await makeAdmin(user);

    let sentBody: unknown = null;
    let sentApiKey: string | undefined;
    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/mechanical/run', (body) => {
        sentBody = body;
        return true;
      })
      .reply(function () {
        sentApiKey = this.req.headers['x-api-key'] as string | undefined;
        return [202, { batch_id: 'batch_1', job_id: 'job_1' }];
      });

    const res = await request(app)
      .post('/api/merlt/ops/ingestion/run')
      .set(authHeader(user))
      .send({
        source: 'visualex_tree',
        source_ref: 'codice-civile',
        scope_label: 'CC libro IV',
        created_by: 'forged-user',
      });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ batch_id: 'batch_1', job_id: 'job_1' });
    expect(sentBody).toEqual({
      source: 'visualex_tree',
      source_ref: 'codice-civile',
      scope_label: 'CC libro IV',
      created_by: user.username,
    });
    expect(sentApiKey).toBe('test-admin-key');
  });

  it('503s when MERL-T is unavailable', async () => {
    const user = await createTestUser('opsing-admin2');
    await makeAdmin(user);

    nock(TEST_MERLT_BASE).post('/api/v1/ingestion/mechanical/run').reply(500, {});

    const res = await request(app)
      .post('/api/merlt/ops/ingestion/run')
      .set(authHeader(user))
      .send({ source: 'visualex_tree', source_ref: 'codice-civile', scope_label: 'CC libro IV' });
    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });

  it('collapses an upstream 401 (e.g. missing MERLT_API_KEY) to 503, not 401', async () => {
    // Regression guard: a 401/403 from MERL-T means the BFF↔MERL-T credential
    // is misconfigured, not that this admin is unauthenticated. It must NOT be
    // propagated verbatim (which would trip the frontend's 401 re-auth
    // interceptor and leak MERL-T's error body) — only 404/409 pass through.
    const user = await createTestUser('opsing-admin-401');
    await makeAdmin(user);

    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/mechanical/run')
      .reply(401, { detail: 'API key required' });

    const res = await request(app)
      .post('/api/merlt/ops/ingestion/run')
      .set(authHeader(user))
      .send({ source: 'visualex_tree', source_ref: 'codice-civile', scope_label: 'CC libro IV' });

    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });

  it('503s on a network/timeout failure, not only on an upstream 5xx', async () => {
    // The 5xx tests exercise MerltServerError; this drives the distinct
    // network-error branch (MerltTimeoutError) — the likeliest unavailability
    // mode (MERL-T slow/cold-start) under the 5s default timeout.
    const user = await createTestUser('opsing-admin-neterr');
    await makeAdmin(user);

    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/mechanical/run')
      .replyWithError({ code: 'ECONNREFUSED', message: 'connection refused' });

    const res = await request(app)
      .post('/api/merlt/ops/ingestion/run')
      .set(authHeader(user))
      .send({ source: 'visualex_tree', source_ref: 'codice-civile', scope_label: 'CC libro IV' });

    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });
});

describe('GET /api/merlt/ops/ingestion/batches', () => {
  it('401s without authentication', async () => {
    const res = await request(app).get('/api/merlt/ops/ingestion/batches');
    expect(res.status).toBe(401);
  });

  it('403s admin_required for a non-admin user', async () => {
    const user = await createTestUser('opsingb-nonadmin');
    const res = await request(app).get('/api/merlt/ops/ingestion/batches').set(authHeader(user));
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('admin_required');
  });

  it('forwards status/limit/offset query params and returns 200', async () => {
    const user = await createTestUser('opsingb-admin');
    await makeAdmin(user);

    let sentQuery: Record<string, string> = {};
    nock(TEST_MERLT_BASE)
      .get('/api/v1/ingestion/mechanical/batches')
      .query((q) => {
        sentQuery = q as Record<string, string>;
        return true;
      })
      .reply(200, { batches: [{ id: 'b1' }] });

    const res = await request(app)
      .get('/api/merlt/ops/ingestion/batches')
      .query({ status: 'pending_review', limit: '10', offset: '5' })
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ batches: [{ id: 'b1' }] });
    expect(sentQuery).toEqual({ status: 'pending_review', limit: '10', offset: '5' });
  });

  it('omits absent query params from the upstream call', async () => {
    const user = await createTestUser('opsingb-admin2');
    await makeAdmin(user);

    let sentQuery: Record<string, string> = {};
    nock(TEST_MERLT_BASE)
      .get('/api/v1/ingestion/mechanical/batches')
      .query((q) => {
        sentQuery = q as Record<string, string>;
        return true;
      })
      .reply(200, { batches: [] });

    const res = await request(app).get('/api/merlt/ops/ingestion/batches').set(authHeader(user));

    expect(res.status).toBe(200);
    expect(sentQuery).toEqual({});
  });

  it('503s when MERL-T is unavailable', async () => {
    const user = await createTestUser('opsingb-admin3');
    await makeAdmin(user);

    nock(TEST_MERLT_BASE).get('/api/v1/ingestion/mechanical/batches').query(true).reply(500, {});

    const res = await request(app).get('/api/merlt/ops/ingestion/batches').set(authHeader(user));
    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });
});

describe('GET /api/merlt/ops/ingestion/batches/:batchId', () => {
  it('401s without authentication', async () => {
    const res = await request(app).get('/api/merlt/ops/ingestion/batches/batch_1');
    expect(res.status).toBe(401);
  });

  it('403s admin_required for a non-admin user', async () => {
    const user = await createTestUser('opsingd-nonadmin');
    const res = await request(app)
      .get('/api/merlt/ops/ingestion/batches/batch_1')
      .set(authHeader(user));
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('admin_required');
  });

  it('forwards node_limit/edge_limit and returns 200 with the batch detail', async () => {
    const user = await createTestUser('opsingd-admin');
    await makeAdmin(user);

    let sentQuery: Record<string, string> = {};
    nock(TEST_MERLT_BASE)
      .get('/api/v1/ingestion/mechanical/batches/batch_1')
      .query((q) => {
        sentQuery = q as Record<string, string>;
        return true;
      })
      .reply(200, { batch_id: 'batch_1', status: 'pending_review', conflict_report: {} });

    const res = await request(app)
      .get('/api/merlt/ops/ingestion/batches/batch_1')
      .query({ node_limit: '20', edge_limit: '30' })
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ batch_id: 'batch_1', status: 'pending_review', conflict_report: {} });
    expect(sentQuery).toEqual({ node_limit: '20', edge_limit: '30' });
  });

  it('passes a 404 batch_not_found through intact', async () => {
    const user = await createTestUser('opsingd-admin2');
    await makeAdmin(user);

    nock(TEST_MERLT_BASE)
      .get('/api/v1/ingestion/mechanical/batches/missing')
      .query(true)
      .reply(404, { detail: 'batch_not_found' });

    const res = await request(app)
      .get('/api/merlt/ops/ingestion/batches/missing')
      .set(authHeader(user));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ detail: 'batch_not_found' });
  });

  it('503s when MERL-T is unavailable', async () => {
    const user = await createTestUser('opsingd-admin3');
    await makeAdmin(user);

    nock(TEST_MERLT_BASE)
      .get('/api/v1/ingestion/mechanical/batches/batch_1')
      .query(true)
      .reply(500, {});

    const res = await request(app)
      .get('/api/merlt/ops/ingestion/batches/batch_1')
      .set(authHeader(user));
    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });
});

describe('POST /api/merlt/ops/ingestion/batches/:batchId/promote', () => {
  it('401s without authentication', async () => {
    const res = await request(app)
      .post('/api/merlt/ops/ingestion/batches/batch_1/promote')
      .send({});
    expect(res.status).toBe(401);
  });

  it('403s admin_required for a non-admin user', async () => {
    const user = await createTestUser('opsingp-nonadmin');
    const res = await request(app)
      .post('/api/merlt/ops/ingestion/batches/batch_1/promote')
      .set(authHeader(user))
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('admin_required');
  });

  it('proxies, injects reviewed_by, ignores a client-supplied reviewed_by, and returns 200', async () => {
    const user = await createTestUser('opsingp-admin');
    await makeAdmin(user);

    let sentBody: unknown = null;
    let sentApiKey: string | undefined;
    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/mechanical/batches/batch_1/promote', (body) => {
        sentBody = body;
        return true;
      })
      .reply(function () {
        sentApiKey = this.req.headers['x-api-key'] as string | undefined;
        return [200, { batch_id: 'batch_1', job_id: 'job_2', status: 'promoting' }];
      });

    const res = await request(app)
      .post('/api/merlt/ops/ingestion/batches/batch_1/promote')
      .set(authHeader(user))
      .send({ force: true, reason: 'looks fine', reviewed_by: 'forged-reviewer' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ batch_id: 'batch_1', job_id: 'job_2', status: 'promoting' });
    expect(sentBody).toEqual({ force: true, reason: 'looks fine', reviewed_by: user.username });
    expect(sentApiKey).toBe('test-admin-key');
  });

  it('defaults force to false when omitted', async () => {
    const user = await createTestUser('opsingp-admin2');
    await makeAdmin(user);

    let sentBody: unknown = null;
    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/mechanical/batches/batch_1/promote', (body) => {
        sentBody = body;
        return true;
      })
      .reply(200, { batch_id: 'batch_1', job_id: 'job_3', status: 'promoting' });

    const res = await request(app)
      .post('/api/merlt/ops/ingestion/batches/batch_1/promote')
      .set(authHeader(user))
      .send({});

    expect(res.status).toBe(200);
    expect(sentBody).toEqual({ force: false, reviewed_by: user.username });
  });

  it('passes a structured 409 urn_conflicts_block_promotion through intact', async () => {
    const user = await createTestUser('opsingp-admin3');
    await makeAdmin(user);

    const conflictBody = {
      detail: {
        error: 'urn_conflicts_block_promotion',
        urn_conflicts: [{ urn: 'urn:x', reason: 'already exists' }],
      },
    };
    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/mechanical/batches/batch_1/promote')
      .reply(409, conflictBody);

    const res = await request(app)
      .post('/api/merlt/ops/ingestion/batches/batch_1/promote')
      .set(authHeader(user))
      .send({});

    expect(res.status).toBe(409);
    expect(res.body).toEqual(conflictBody);
    expect(res.body.detail.error).toBe('urn_conflicts_block_promotion');
  });

  it('passes a 409 batch_expired through intact', async () => {
    const user = await createTestUser('opsingp-admin4');
    await makeAdmin(user);

    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/mechanical/batches/batch_1/promote')
      .reply(409, { detail: 'batch_expired' });

    const res = await request(app)
      .post('/api/merlt/ops/ingestion/batches/batch_1/promote')
      .set(authHeader(user))
      .send({});

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ detail: 'batch_expired' });
  });

  it('passes a 404 batch_not_found through intact', async () => {
    const user = await createTestUser('opsingp-admin5');
    await makeAdmin(user);

    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/mechanical/batches/missing/promote')
      .reply(404, { detail: 'batch_not_found' });

    const res = await request(app)
      .post('/api/merlt/ops/ingestion/batches/missing/promote')
      .set(authHeader(user))
      .send({});

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ detail: 'batch_not_found' });
  });

  it('503s when MERL-T is unavailable', async () => {
    const user = await createTestUser('opsingp-admin6');
    await makeAdmin(user);

    nock(TEST_MERLT_BASE).post('/api/v1/ingestion/mechanical/batches/batch_1/promote').reply(500, {});

    const res = await request(app)
      .post('/api/merlt/ops/ingestion/batches/batch_1/promote')
      .set(authHeader(user))
      .send({});
    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });
});

describe('POST /api/merlt/ops/ingestion/batches/:batchId/reject', () => {
  it('401s without authentication', async () => {
    const res = await request(app)
      .post('/api/merlt/ops/ingestion/batches/batch_1/reject')
      .send({ reason: 'no' });
    expect(res.status).toBe(401);
  });

  it('403s admin_required for a non-admin user', async () => {
    const user = await createTestUser('opsingr-nonadmin');
    const res = await request(app)
      .post('/api/merlt/ops/ingestion/batches/batch_1/reject')
      .set(authHeader(user))
      .send({ reason: 'no' });
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('admin_required');
  });

  it('400s when reason is missing, without calling MERL-T', async () => {
    const user = await createTestUser('opsingr-noreason');
    await makeAdmin(user);

    const res = await request(app)
      .post('/api/merlt/ops/ingestion/batches/batch_1/reject')
      .set(authHeader(user))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('invalid_request');
  });

  it('proxies, injects reviewed_by, ignores a client-supplied reviewed_by, and returns 200', async () => {
    const user = await createTestUser('opsingr-admin');
    await makeAdmin(user);

    let sentBody: unknown = null;
    let sentApiKey: string | undefined;
    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/mechanical/batches/batch_1/reject', (body) => {
        sentBody = body;
        return true;
      })
      .reply(function () {
        sentApiKey = this.req.headers['x-api-key'] as string | undefined;
        return [200, { batch_id: 'batch_1', status: 'rejected' }];
      });

    const res = await request(app)
      .post('/api/merlt/ops/ingestion/batches/batch_1/reject')
      .set(authHeader(user))
      .send({ reason: 'duplicate corpus', reviewed_by: 'forged-reviewer' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ batch_id: 'batch_1', status: 'rejected' });
    expect(sentBody).toEqual({ reason: 'duplicate corpus', reviewed_by: user.username });
    expect(sentApiKey).toBe('test-admin-key');
  });

  it('503s when MERL-T is unavailable', async () => {
    const user = await createTestUser('opsingr-admin2');
    await makeAdmin(user);

    nock(TEST_MERLT_BASE).post('/api/v1/ingestion/mechanical/batches/batch_1/reject').reply(500, {});

    const res = await request(app)
      .post('/api/merlt/ops/ingestion/batches/batch_1/reject')
      .set(authHeader(user))
      .send({ reason: 'x' });
    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });
});
