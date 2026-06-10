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
import { _resetOpsClientForTests } from '../../../src/routes/merlt/ops';

const TEST_MERLT_BASE = 'http://merlt-test.local:8000';

beforeAll(() => {
  process.env.MERLT_API_URL = TEST_MERLT_BASE;
  process.env.MERLT_TIMEOUT_MS = '500';
  process.env.MERLT_API_KEY = 'test-admin-key';
  _resetOpsClientForTests();
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

describe('POST /api/merlt/ops/rlcf/training/start (loop-closure A5)', () => {
  it('401s without authentication', async () => {
    const res = await request(app).post('/api/merlt/ops/rlcf/training/start').send({});
    expect(res.status).toBe(401);
  });

  it('403s admin_required for a non-admin user', async () => {
    const user = await createTestUser('ops-nonadmin');
    const res = await request(app)
      .post('/api/merlt/ops/rlcf/training/start')
      .set(authHeader(user))
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('admin_required');
  });

  it('proxies to MERL-T and returns 202 for an admin', async () => {
    const user = await createTestUser('ops-admin');
    await makeAdmin(user);

    let sentBody: unknown = null;
    let sentApiKey: string | undefined;
    nock(TEST_MERLT_BASE)
      .post('/api/v1/rlcf/training/start', (body) => {
        sentBody = body;
        return true;
      })
      .reply(function (_uri, _body) {
        sentApiKey = this.req.headers['x-api-key'] as string | undefined;
        return [200, { success: true, training_id: 'train_1', message: 'avviato' }];
      });

    const res = await request(app)
      .post('/api/merlt/ops/rlcf/training/start')
      .set(authHeader(user))
      .send({ epochs: 5 });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.training_id).toBe('train_1');
    expect(sentBody).toEqual({ epochs: 5 });
    // MERL-T auth scheme is X-API-Key, NOT Authorization: Bearer.
    // Regression guard: the opsClient previously sent `Authorization: Bearer`
    // which MERL-T rejects with 401 "API key required".
    expect(sentApiKey).toBe('test-admin-key');
  });

  it('503s when MERL-T is unavailable', async () => {
    const user = await createTestUser('ops-admin2');
    await makeAdmin(user);

    nock(TEST_MERLT_BASE).post('/api/v1/rlcf/training/start').reply(500, {});

    const res = await request(app)
      .post('/api/merlt/ops/rlcf/training/start')
      .set(authHeader(user))
      .send({});
    expect(res.status).toBe(503);
  });
});
