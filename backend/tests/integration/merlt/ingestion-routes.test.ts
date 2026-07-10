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
import { _resetIngestionClientForTests } from '../../../src/routes/merlt/ingestion';

const TEST_MERLT_BASE = 'http://merlt-test.local:8000';

beforeAll(() => {
  process.env.MERLT_API_URL = TEST_MERLT_BASE;
  process.env.MERLT_TIMEOUT_MS = '500';
  process.env.MERLT_API_KEY = 'test-ingestion-key';
  _resetIngestionClientForTests();
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
  delete process.env.MERLT_API_KEY;
});

async function grantFull(user: TestUser): Promise<void> {
  await request(app).post('/api/merlt/consent').set(authHeader(user)).send({ level: 'full' });
}

async function grantBasic(user: TestUser): Promise<void> {
  await request(app).post('/api/merlt/consent').set(authHeader(user)).send({ level: 'basic' });
}

/**
 * Blocks the MERL-T /profile/full sync that authorityCache.getOrSyncAuthority
 * attempts on a cache miss. Without a mock, disableNetConnect() makes fetch
 * throw a network error → getOrSyncAuthority swallows it (MerltClientError)
 * and returns null → resolveUserAuthority falls back to 0.5. Some tests
 * exercise that fallback explicitly by NOT calling this helper; others seed
 * a MerltUserAuthorityCache row instead (no network call at all, since the
 * cache is fresh).
 */
function mockProfileSync(userId: string, score: number): void {
  nock(TEST_MERLT_BASE)
    .get('/api/v1/profile/full')
    .query((q) => q.user_id === userId)
    .reply(200, {
      user_id: userId,
      authority: {
        score,
        tier: 'test-tier',
        breakdown: { baseline: score, track_record: 0, level_authority: 0 },
      },
      stats: { total_contributions: 0, approved: 0, rejected: 0, pending: 0, vote_weight: 0 },
    });
}

async function seedAuthority(userId: string, score: number): Promise<void> {
  await prisma.merltUserAuthorityCache.create({
    data: {
      userId,
      authorityScore: score,
      baselineQual: 'test-tier',
      trackRecord: 0,
      performance: 0,
      totalContributions: 0,
    },
  });
}

const previewBody = {
  tipo_atto: 'codice civile',
  articolo: '2043',
  trigger: 'annotation' as const,
};

describe('POST /api/merlt/ingestion/preview', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('ingestion-preview');
  });

  it('403s without full consent', async () => {
    await grantBasic(user);
    const res = await request(app)
      .post('/api/merlt/ingestion/preview')
      .set(authHeader(user))
      .send(previewBody);
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('contribution_consent_required');
  });

  it('403s with no consent record at all', async () => {
    const res = await request(app)
      .post('/api/merlt/ingestion/preview')
      .set(authHeader(user))
      .send(previewBody);
    expect(res.status).toBe(403);
  });

  it('401s when unauthenticated', async () => {
    const res = await request(app).post('/api/merlt/ingestion/preview').send(previewBody);
    expect(res.status).toBe(401);
  });

  it('400s on invalid body', async () => {
    await grantFull(user);
    const res = await request(app)
      .post('/api/merlt/ingestion/preview')
      .set(authHeader(user))
      .send({ tipo_atto: 'codice civile' }); // missing articolo/trigger
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('invalid_body');
  });

  it('injects server-resolved user_authority from a cached score, ignoring any client-supplied value', async () => {
    await grantFull(user);
    await seedAuthority(user.id, 0.82);

    let sentBody: Record<string, unknown> = {};
    let sentApiKey: string | undefined;
    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/preview', (body: unknown) => {
        sentBody = body as Record<string, unknown>;
        return true;
      })
      .reply(function () {
        sentApiKey = this.req.headers['x-api-key'] as string | undefined;
        return [
          200,
          {
            success: true,
            status: 'auto_approved',
            reason: 'ok',
            preview: { nodes: [], edges: [] },
            pending_id: null,
            required_approvals: 0,
            article_urn: 'urn:nir:test',
            nodes_created: [],
            relations_created: [],
            errors: [],
            processed_at: new Date().toISOString(),
          },
        ];
      });

    const res = await request(app)
      .post('/api/merlt/ingestion/preview')
      .set(authHeader(user))
      .send({ ...previewBody, user_authority: 0.01 }); // client cannot set this

    expect(res.status).toBe(200);
    expect(sentBody.user_id).toBe(user.id);
    expect(sentBody.user_authority).toBe(0.82);
    expect(sentApiKey).toBe('test-ingestion-key');
  });

  it('falls back to a neutral 0.5 authority when no cache exists and MERL-T sync is unreachable', async () => {
    await grantFull(user);
    // No seeded authority row, no profile-sync mock: the sync attempt itself
    // hits disableNetConnect() and is swallowed by getOrSyncAuthority.

    let sentBody: Record<string, unknown> = {};
    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/preview', (body: unknown) => {
        sentBody = body as Record<string, unknown>;
        return true;
      })
      .reply(200, {
        success: true,
        status: 'pending_validation',
        reason: 'ok',
        preview: {},
        pending_id: 'pending-1',
        required_approvals: 2,
        article_urn: null,
        nodes_created: [],
        relations_created: [],
        errors: [],
        processed_at: new Date().toISOString(),
      });

    const res = await request(app)
      .post('/api/merlt/ingestion/preview')
      .set(authHeader(user))
      .send(previewBody);

    expect(res.status).toBe(200);
    expect(sentBody.user_authority).toBe(0.5);
  });

  it('resolves user_authority via a fresh MERL-T profile sync when the cache is empty', async () => {
    await grantFull(user);
    mockProfileSync(user.id, 0.91);

    let sentBody: Record<string, unknown> = {};
    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/preview', (body: unknown) => {
        sentBody = body as Record<string, unknown>;
        return true;
      })
      .reply(200, {
        success: true,
        status: 'auto_approved',
        reason: 'ok',
        preview: {},
        pending_id: null,
        required_approvals: 0,
        article_urn: 'urn:nir:test',
        nodes_created: [],
        relations_created: [],
        errors: [],
        processed_at: new Date().toISOString(),
      });

    const res = await request(app)
      .post('/api/merlt/ingestion/preview')
      .set(authHeader(user))
      .send(previewBody);

    expect(res.status).toBe(200);
    expect(sentBody.user_authority).toBe(0.91);

    const cached = await prisma.merltUserAuthorityCache.findUnique({ where: { userId: user.id } });
    expect(cached?.authorityScore).toBe(0.91);
  });

  it('returns 503 when MERL-T ingestion endpoint is down', async () => {
    await grantFull(user);
    await seedAuthority(user.id, 0.6);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/preview')
      .replyWithError({ code: 'ECONNREFUSED', message: 'down' });

    const res = await request(app)
      .post('/api/merlt/ingestion/preview')
      .set(authHeader(user))
      .send(previewBody);

    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });

  it('passes through a 400 from MERL-T (e.g. invalid trigger/relation enum)', async () => {
    await grantFull(user);
    await seedAuthority(user.id, 0.6);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/preview')
      .reply(400, { detail: 'invalid relation_type' });

    const res = await request(app)
      .post('/api/merlt/ingestion/preview')
      .set(authHeader(user))
      .send(previewBody);

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('invalid relation_type');
  });

  it('forwards suggested_relations and metadata verbatim', async () => {
    await grantFull(user);
    await seedAuthority(user.id, 0.7);

    let sentBody: Record<string, unknown> = {};
    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/preview', (body: unknown) => {
        sentBody = body as Record<string, unknown>;
        return true;
      })
      .reply(200, {
        success: true,
        status: 'auto_approved',
        reason: 'ok',
        preview: {},
        pending_id: null,
        required_approvals: 0,
        article_urn: null,
        nodes_created: [],
        relations_created: [],
        errors: [],
        processed_at: new Date().toISOString(),
      });

    const res = await request(app)
      .post('/api/merlt/ingestion/preview')
      .set(authHeader(user))
      .send({
        ...previewBody,
        suggested_relations: [
          {
            source_urn: 'urn:a',
            target_urn: 'urn:b',
            relation_type: 'RIFERIMENTO',
            evidence: 'user_annotation',
            confidence: 0.9,
          },
        ],
        metadata: { note_id: 'abc123' },
      });

    expect(res.status).toBe(200);
    expect(sentBody.suggested_relations).toEqual([
      {
        source_urn: 'urn:a',
        target_urn: 'urn:b',
        relation_type: 'RIFERIMENTO',
        evidence: 'user_annotation',
        confidence: 0.9,
      },
    ]);
    expect(sentBody.metadata).toEqual({ note_id: 'abc123' });
    expect(sentBody.source).toBe('visualex');
  });
});

describe('POST /api/merlt/ingestion/process', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('ingestion-process');
  });

  it('403s without full consent', async () => {
    const res = await request(app)
      .post('/api/merlt/ingestion/process')
      .set(authHeader(user))
      .send(previewBody);
    expect(res.status).toBe(403);
  });

  it('forwards to MERL-T and returns the ingestion result', async () => {
    await grantFull(user);
    await seedAuthority(user.id, 0.75);

    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/process')
      .reply(200, {
        success: true,
        status: 'auto_approved',
        reason: 'authority above threshold',
        preview: { nodes: ['n1'] },
        pending_id: null,
        required_approvals: 0,
        article_urn: 'urn:nir:stato:codice.civile:1942;2043',
        nodes_created: ['n1'],
        relations_created: [],
        errors: [],
        processed_at: new Date().toISOString(),
      });

    const res = await request(app)
      .post('/api/merlt/ingestion/process')
      .set(authHeader(user))
      .send(previewBody);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('auto_approved');
    expect(res.body.nodes_created).toEqual(['n1']);
  });

  it('returns 503 when MERL-T is down', async () => {
    await grantFull(user);
    await seedAuthority(user.id, 0.6);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/process')
      .replyWithError({ code: 'ECONNREFUSED', message: 'down' });

    const res = await request(app)
      .post('/api/merlt/ingestion/process')
      .set(authHeader(user))
      .send(previewBody);

    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });
});

describe('GET /api/merlt/ingestion/pending', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('ingestion-pending');
  });

  it('returns the pending list for an authenticated user (no consent required)', async () => {
    nock(TEST_MERLT_BASE)
      .get('/api/v1/ingestion/pending')
      .query((q) => q.limit === '20')
      .reply(200, [
        {
          id: 'pending-1',
          type: 'ingestion',
          target_urn: 'urn:nir:test',
          contributor_id: 'other-user',
          contributor_authority: 0.4,
          source: 'visualex',
          trigger: 'search_not_found',
          created_at: new Date().toISOString(),
          expires_at: new Date().toISOString(),
          approvals: 0,
          rejections: 0,
          required_approvals: 2,
          status: 'pending',
        },
      ]);

    const res = await request(app)
      .get('/api/merlt/ingestion/pending')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('pending-1');
  });

  it('clamps limit to the 1..100 window', async () => {
    let seen: Record<string, unknown> = {};
    nock(TEST_MERLT_BASE)
      .get('/api/v1/ingestion/pending')
      .query((q) => {
        seen = q;
        return true;
      })
      .reply(200, []);

    await request(app)
      .get('/api/merlt/ingestion/pending?limit=500')
      .set(authHeader(user));

    expect(seen.limit).toBe('100');
  });

  it('401s when unauthenticated', async () => {
    const res = await request(app).get('/api/merlt/ingestion/pending');
    expect(res.status).toBe(401);
  });

  it('returns 503 when MERL-T is down', async () => {
    nock(TEST_MERLT_BASE)
      .get('/api/v1/ingestion/pending')
      .query(true)
      .replyWithError({ code: 'ECONNREFUSED', message: 'down' });

    const res = await request(app)
      .get('/api/merlt/ingestion/pending')
      .set(authHeader(user));

    expect(res.status).toBe(503);
  });
});

describe('POST /api/merlt/ingestion/validate', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('ingestion-validate');
  });

  it('403s without full consent', async () => {
    const res = await request(app)
      .post('/api/merlt/ingestion/validate')
      .set(authHeader(user))
      .send({ pending_id: 'pending-1', vote: true });
    expect(res.status).toBe(403);
  });

  it('400s on invalid body', async () => {
    await grantFull(user);
    const res = await request(app)
      .post('/api/merlt/ingestion/validate')
      .set(authHeader(user))
      .send({ vote: true }); // missing pending_id
    expect(res.status).toBe(400);
  });

  it('injects voter_id and server-resolved voter_authority, ignoring a client-supplied value', async () => {
    await grantFull(user);
    await seedAuthority(user.id, 0.55);

    let sentBody: Record<string, unknown> = {};
    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/validate', (body: unknown) => {
        sentBody = body as Record<string, unknown>;
        return true;
      })
      .reply(200, {
        success: true,
        vote_recorded: true,
        pending_status: 'pending',
        message: 'Vote recorded, waiting for more votes',
      });

    const res = await request(app)
      .post('/api/merlt/ingestion/validate')
      .set(authHeader(user))
      .send({ pending_id: 'pending-1', vote: true, voter_authority: 0.99, reason: 'looks right' });

    expect(res.status).toBe(200);
    expect(res.body.pending_status).toBe('pending');
    expect(sentBody.voter_id).toBe(user.id);
    expect(sentBody.voter_authority).toBe(0.55);
    expect(sentBody.pending_id).toBe('pending-1');
    expect(sentBody.reason).toBe('looks right');
  });

  it('returns 503 when MERL-T is down', async () => {
    await grantFull(user);
    await seedAuthority(user.id, 0.5);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/validate')
      .replyWithError({ code: 'ECONNREFUSED', message: 'down' });

    const res = await request(app)
      .post('/api/merlt/ingestion/validate')
      .set(authHeader(user))
      .send({ pending_id: 'pending-1', vote: false });

    expect(res.status).toBe(503);
  });

  it('passes through a 404 from MERL-T (unknown/expired pending id)', async () => {
    await grantFull(user);
    await seedAuthority(user.id, 0.5);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/ingestion/validate')
      .reply(404, { detail: 'Pending validation pending-x not found or already processed' });

    const res = await request(app)
      .post('/api/merlt/ingestion/validate')
      .set(authHeader(user))
      .send({ pending_id: 'pending-x', vote: true });

    expect(res.status).toBe(404);
  });
});
