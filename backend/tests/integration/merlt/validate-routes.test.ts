import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import nock from 'nock';
import { request, app, createTestUser, authHeader, type TestUser } from '../../helpers';
import { _resetValidateClientForTests } from '../../../src/routes/merlt/validate';

const TEST_MERLT_BASE = 'http://merlt-test.local:8000';

beforeAll(() => {
  process.env.MERLT_API_URL = TEST_MERLT_BASE;
  process.env.MERLT_TIMEOUT_MS = '500';
  process.env.MERLT_CONTRIB_TIMEOUT_MS = '500';
  _resetValidateClientForTests();
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
  nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
});
afterEach(() => nock.cleanAll());
afterAll(() => {
  nock.enableNetConnect();
  nock.restore();
  delete process.env.MERLT_API_URL;
  delete process.env.MERLT_TIMEOUT_MS;
  delete process.env.MERLT_CONTRIB_TIMEOUT_MS;
});

async function grantFull(user: TestUser): Promise<void> {
  await request(app).post('/api/merlt/consent').set(authHeader(user)).send({ level: 'full' });
}

describe('MERL-T validation routes (Slice 2c #8)', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('validate-alice');
  });

  it('403s without full (validation) consent', async () => {
    const res = await request(app).get('/api/merlt/validate/pending').set(authHeader(user));
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('validation_consent_required');
  });

  it('proxies the pending queue with full consent', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .get('/api/v1/enrichment/pending')
      .query(true)
      .reply(200, {
        pending_entities: [{ entity_id: 'e1', entity_text: 'Buona fede' }],
        pending_relations: [],
        total_entities: 1,
        total_relations: 0,
        user_can_vote: 1,
      });
    const res = await request(app).get('/api/merlt/validate/pending').set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body.total_entities).toBe(1);
  });

  it('forwards an entity vote with the voter user_id', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/enrichment/validate-entity', (b) => {
        const body = b as { entity_id: string; vote: string; user_id: string };
        return body.entity_id === 'e1' && body.vote === 'approve' && body.user_id === user.id;
      })
      .reply(200, { entity_id: 'e1', validation_status: 'pending', votes_count: 1 });
    const res = await request(app)
      .post('/api/merlt/validate/entity')
      .set(authHeader(user))
      .send({ entityId: 'e1', vote: 'approve' });
    expect(res.status).toBe(200);
  });

  it('400s on an invalid vote value', async () => {
    await grantFull(user);
    const res = await request(app)
      .post('/api/merlt/validate/entity')
      .set(authHeader(user))
      .send({ entityId: 'e1', vote: 'maybe' });
    expect(res.status).toBe(400);
  });
});
