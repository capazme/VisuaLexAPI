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

describe('GET/PUT /api/merlt/ops/config', () => {
  it('passes through an enum param with its choices array on GET', async () => {
    const user = await createTestUser('ops-config-get-admin');
    await makeAdmin(user);

    nock(TEST_MERLT_BASE)
      .get('/api/v1/admin/config')
      .reply(200, {
        params: [
          {
            key: 'synthesis_model',
            kind: 'enum',
            value: 'gpt-4o',
            default: 'gpt-4o-mini',
            choices: ['gpt-4o', 'gpt-4o-mini', 'claude-3-haiku'],
            description: 'Model used for synthesis',
            requires_restart: false,
          },
          {
            key: 'gating_threshold',
            kind: 'float',
            value: 0.5,
            default: 0.5,
            min: 0,
            max: 1,
            step: 0.05,
            description: 'Gating threshold',
            requires_restart: false,
          },
        ],
      });

    const res = await request(app)
      .get('/api/merlt/ops/config')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.params[0]).toMatchObject({
      key: 'synthesis_model',
      kind: 'enum',
      value: 'gpt-4o',
      choices: ['gpt-4o', 'gpt-4o-mini', 'claude-3-haiku'],
    });
    expect(res.body.params[1]).toMatchObject({ key: 'gating_threshold', value: 0.5 });
  });

  it('accepts a string value for an enum key and forwards it to MERL-T', async () => {
    const user = await createTestUser('ops-config-put-admin');
    await makeAdmin(user);

    let sentBody: unknown = null;
    nock(TEST_MERLT_BASE)
      .put('/api/v1/admin/config/synthesis_model', (body) => {
        sentBody = body;
        return true;
      })
      .reply(200, {
        key: 'synthesis_model',
        kind: 'enum',
        value: 'claude-3-haiku',
        default: 'gpt-4o-mini',
        choices: ['gpt-4o', 'gpt-4o-mini', 'claude-3-haiku'],
        description: 'Model used for synthesis',
        requires_restart: false,
      });

    const res = await request(app)
      .put('/api/merlt/ops/config/synthesis_model')
      .set(authHeader(user))
      .send({ value: 'claude-3-haiku' });

    expect(res.status).toBe(200);
    expect(res.body.value).toBe('claude-3-haiku');
    expect(res.body.choices).toEqual(['gpt-4o', 'gpt-4o-mini', 'claude-3-haiku']);
    expect(sentBody).toEqual({ value: 'claude-3-haiku' });
  });

  it('400s when value is neither number, boolean, nor string', async () => {
    const user = await createTestUser('ops-config-put-badtype-admin');
    await makeAdmin(user);

    const res = await request(app)
      .put('/api/merlt/ops/config/some_key')
      .set(authHeader(user))
      .send({ value: { nested: true } });

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('value must be a number, boolean, or string');
  });

  it('401s without authentication', async () => {
    const res = await request(app).get('/api/merlt/ops/config');
    expect(res.status).toBe(401);
  });
});
