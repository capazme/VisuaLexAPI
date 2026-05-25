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
import { _resetGraphClientForTests } from '../../../src/routes/merlt/graph';

const TEST_MERLT_BASE = 'http://merlt-test.local:8000';
const INTERNAL_SECRET = 'test-internal-secret';

beforeAll(() => {
  process.env.MERLT_API_URL = TEST_MERLT_BASE;
  process.env.MERLT_TIMEOUT_MS = '500';
  process.env.MERLT_INTERNAL_SECRET = INTERNAL_SECRET;
  _resetGraphClientForTests();
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
  delete process.env.MERLT_INTERNAL_SECRET;
});

async function grantConsent(user: TestUser, level: 'basic' | 'full' = 'basic'): Promise<void> {
  await request(app).post('/api/merlt/consent').set(authHeader(user)).send({ level });
}

function mockSubgraph(rootUrn: string) {
  return {
    nodes: [
      { id: rootUrn, urn: rootUrn, type: 'Norma', label: 'Art. 2043 c.c.', properties: {}, metadata: {} },
      { id: 'principio:abc', urn: null, type: 'Principio', label: 'Neminem laedere', properties: {}, metadata: {} },
    ],
    edges: [
      { id: `${rootUrn}-ESPRIME-principio:abc`, source: rootUrn, target: 'principio:abc', type: 'ESPRIME_PRINCIPIO', properties: {} },
    ],
    metadata: { total_nodes: 2, total_edges: 1, depth_reached: 1, root_node_id: rootUrn },
  };
}

describe('GET /api/merlt/graph/article/:urn (MERLT-2a.4)', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser('graph-alice');
  });

  it('returns 200 with nodes/edges when MERL-T returns a subgraph', async () => {
    await grantConsent(user, 'basic');
    const urn = 'urn:nir:stato:codice.civile:1942;2043';

    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/subgraph')
      .query((q) => q.root_urn === urn)
      .reply(200, mockSubgraph(urn));

    const res = await request(app)
      .get(`/api/merlt/graph/article/${encodeURIComponent(urn)}`)
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(2);
    expect(res.body.edges).toHaveLength(1);
    expect(res.body.nodes[0].urn).toBe(urn);
  });

  it('forwards depth and limit query params to MERL-T (clamped)', async () => {
    await grantConsent(user, 'basic');
    const urn = 'urn:nir:stato:codice.civile:1942;2043';

    let seen: Record<string, unknown> = {};
    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/subgraph')
      .query((q) => {
        seen = q;
        return q.root_urn === urn;
      })
      .reply(200, mockSubgraph(urn));

    const res = await request(app)
      .get(`/api/merlt/graph/article/${encodeURIComponent(urn)}?depth=1&limit=25`)
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(seen.depth).toBe('1');
    expect(seen.max_nodes).toBe('25');
  });

  it('defaults to depth=2 max_nodes=500 when no params are given', async () => {
    await grantConsent(user, 'basic');
    const urn = 'urn:nir:stato:codice.civile:1942;2043';

    let seen: Record<string, unknown> = {};
    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/subgraph')
      .query((q) => {
        seen = q;
        return q.root_urn === urn;
      })
      .reply(200, mockSubgraph(urn));

    await request(app)
      .get(`/api/merlt/graph/article/${encodeURIComponent(urn)}`)
      .set(authHeader(user));

    expect(seen.depth).toBe('2');
    expect(seen.max_nodes).toBe('500');
  });

  it('clamps depth below range up to the lower bound (1)', async () => {
    await grantConsent(user, 'basic');
    const urn = 'urn:nir:stato:codice.civile:1942;2043';

    let seen: Record<string, unknown> = {};
    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/subgraph')
      .query((q) => {
        seen = q;
        return q.root_urn === urn;
      })
      .reply(200, mockSubgraph(urn));

    await request(app)
      .get(`/api/merlt/graph/article/${encodeURIComponent(urn)}?depth=0`)
      .set(authHeader(user));

    expect(seen.depth).toBe('1');
  });

  it('clamps an out-of-range depth to the 1..3 window', async () => {
    await grantConsent(user, 'basic');
    const urn = 'urn:nir:stato:codice.civile:1942;2043';

    let seen: Record<string, unknown> = {};
    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/subgraph')
      .query((q) => {
        seen = q;
        return q.root_urn === urn;
      })
      .reply(200, mockSubgraph(urn));

    await request(app)
      .get(`/api/merlt/graph/article/${encodeURIComponent(urn)}?depth=99`)
      .set(authHeader(user));

    expect(seen.depth).toBe('3');
  });

  it('returns 503 merlt_unavailable when MERL-T is down', async () => {
    await grantConsent(user, 'basic');
    const urn = 'urn:nir:stato:codice.civile:1942;2043';

    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/subgraph')
      .query(true)
      .replyWithError({ code: 'ECONNREFUSED', message: 'connection refused' });

    const res = await request(app)
      .get(`/api/merlt/graph/article/${encodeURIComponent(urn)}`)
      .set(authHeader(user));

    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/merlt/graph/article/urn:test');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/merlt/graph/search (MERLT-2a.9)', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser('graph-search');
  });

  it('returns MERL-T entity search results', async () => {
    await grantConsent(user, 'basic');
    const results = [
      { id: 'norma:2043', nome: 'Art. 2043 c.c.', tipo: 'Norma', urn: 'urn:nir:...;2043' },
      { id: 'concetto:colpa', nome: 'Colpa', tipo: 'ConcettoGiuridico' },
    ];

    let seen: Record<string, unknown> = {};
    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/entities/search')
      .query((q) => {
        seen = q;
        return true;
      })
      .reply(200, results);

    const res = await request(app)
      .get('/api/merlt/graph/search?q=2043&limit=5')
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(seen.q).toBe('2043');
    expect(seen.limit).toBe('5');
  });

  it('returns 400 when q is missing or blank', async () => {
    const res = await request(app)
      .get('/api/merlt/graph/search?q=%20')
      .set(authHeader(user));
    expect(res.status).toBe(400);
  });

  it('returns 503 when MERL-T is down', async () => {
    nock(TEST_MERLT_BASE)
      .get('/api/v1/graph/entities/search')
      .query(true)
      .replyWithError({ code: 'ECONNREFUSED', message: 'down' });

    const res = await request(app)
      .get('/api/merlt/graph/search?q=colpa')
      .set(authHeader(user));
    expect(res.status).toBe(503);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/merlt/graph/search?q=x');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/merlt/graph/ingest (MERLT-2a.4)', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser('graph-bob');
  });

  it('returns 202 + jobId and creates a job row for a new urn', async () => {
    await grantConsent(user, 'basic');
    const urn = 'urn:nir:stato:codice.civile:1942;1218';

    nock(TEST_MERLT_BASE)
      .post('/api/v1/graph/ingest-article', (body: unknown) => {
        const b = body as { urn: string; options?: { bff_job_id?: string } };
        return b.urn === urn && typeof b.options?.bff_job_id === 'string';
      })
      .reply(202, { task_id: 'ingest:abc123', status: 'queued', urn });

    const res = await request(app)
      .post('/api/merlt/graph/ingest')
      .set(authHeader(user))
      .send({ urn });

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeDefined();
    expect(res.body.status).toBe('pending');

    const rows = await prisma.merltIngestionJob.findMany({ where: { articleUrn: urn } });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(user.id);
    expect(rows[0].taskId).toBe('ingest:abc123');
  });

  it('is idempotent: same urn twice creates only ONE job row', async () => {
    await grantConsent(user, 'basic');
    const urn = 'urn:nir:stato:codice.civile:1942;1453';

    nock(TEST_MERLT_BASE)
      .post('/api/v1/graph/ingest-article')
      .reply(202, { task_id: 'ingest:dup', status: 'queued', urn });

    const first = await request(app)
      .post('/api/merlt/graph/ingest')
      .set(authHeader(user))
      .send({ urn });
    expect(first.status).toBe(202);

    const second = await request(app)
      .post('/api/merlt/graph/ingest')
      .set(authHeader(user))
      .send({ urn });
    // Idempotency hit → 200 with the existing job.
    expect(second.status).toBe(200);
    expect(second.body.jobId).toBe(first.body.jobId);

    const rows = await prisma.merltIngestionJob.findMany({ where: { articleUrn: urn } });
    expect(rows).toHaveLength(1);
  });

  it('still returns 202 + job when MERL-T enqueue fails (best-effort)', async () => {
    await grantConsent(user, 'basic');
    const urn = 'urn:nir:stato:codice.civile:1942;2059';

    nock(TEST_MERLT_BASE)
      .post('/api/v1/graph/ingest-article')
      .replyWithError({ code: 'ECONNREFUSED', message: 'down' });

    const res = await request(app)
      .post('/api/merlt/graph/ingest')
      .set(authHeader(user))
      .send({ urn });

    expect(res.status).toBe(202);
    const rows = await prisma.merltIngestionJob.findMany({ where: { articleUrn: urn } });
    expect(rows).toHaveLength(1);
    expect(rows[0].taskId).toBeNull();
  });

  it('rejects without consent (403)', async () => {
    const res = await request(app)
      .post('/api/merlt/graph/ingest')
      .set(authHeader(user))
      .send({ urn: 'urn:test' });
    expect(res.status).toBe(403);
  });

  it('returns 400 on invalid body', async () => {
    await grantConsent(user, 'basic');
    const res = await request(app)
      .post('/api/merlt/graph/ingest')
      .set(authHeader(user))
      .send({ urn: '' });
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('invalid_body');
  });
});

describe('GET /api/merlt/graph/jobs/:jobId/status (MERLT-2a.4)', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser('graph-carol');
  });

  it('returns the job for the owner', async () => {
    const job = await prisma.merltIngestionJob.create({
      data: {
        articleUrn: 'urn:test:status',
        userId: user.id,
        status: 'completed',
        nodesCreated: 7,
        edgesCreated: 12,
      },
    });

    const res = await request(app)
      .get(`/api/merlt/graph/jobs/${job.id}/status`)
      .set(authHeader(user));

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe(job.id);
    expect(res.body.status).toBe('completed');
    expect(res.body.nodesCreated).toBe(7);
    expect(res.body.edgesCreated).toBe(12);
  });

  it('returns 404 for a non-existent or non-owned job', async () => {
    const other = await createTestUser('graph-carol-other');
    const job = await prisma.merltIngestionJob.create({
      data: { articleUrn: 'urn:test:other', userId: other.id, status: 'pending' },
    });

    const res = await request(app)
      .get(`/api/merlt/graph/jobs/${job.id}/status`)
      .set(authHeader(user));

    expect(res.status).toBe(404);
  });
});

describe('POST /api/merlt/internal/job-callback (MERLT-2a.4)', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser('graph-dave');
  });

  it('updates the job to completed with counts when the secret is correct', async () => {
    const job = await prisma.merltIngestionJob.create({
      data: { articleUrn: 'urn:test:cb', userId: user.id, status: 'pending' },
    });

    const res = await request(app)
      .post('/api/merlt/internal/job-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'completed', nodesCreated: 3, edgesCreated: 5 });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);

    const updated = await prisma.merltIngestionJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe('completed');
    expect(updated?.nodesCreated).toBe(3);
    expect(updated?.edgesCreated).toBe(5);
    expect(updated?.completedAt).not.toBeNull();
  });

  it('records error and failed status', async () => {
    const job = await prisma.merltIngestionJob.create({
      data: { articleUrn: 'urn:test:cb-fail', userId: user.id, status: 'pending' },
    });

    const res = await request(app)
      .post('/api/merlt/internal/job-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'failed', error: 'scrape timeout' });

    expect(res.status).toBe(200);
    const updated = await prisma.merltIngestionJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe('failed');
    expect(updated?.errorMessage).toBe('scrape timeout');
    expect(updated?.completedAt).not.toBeNull();
  });

  it('updates the job to timeout and stamps completedAt', async () => {
    const job = await prisma.merltIngestionJob.create({
      data: { articleUrn: 'urn:test:cb-timeout', userId: user.id, status: 'running' },
    });

    const res = await request(app)
      .post('/api/merlt/internal/job-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'timeout', error: 'ingestion exceeded budget' });

    expect(res.status).toBe(200);
    const updated = await prisma.merltIngestionJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe('timeout');
    expect(updated?.errorMessage).toBe('ingestion exceeded budget');
    expect(updated?.completedAt).not.toBeNull();
  });

  it('updates the job to running and stamps startedAt (not completedAt)', async () => {
    const job = await prisma.merltIngestionJob.create({
      data: { articleUrn: 'urn:test:cb-running', userId: user.id, status: 'pending' },
    });

    const res = await request(app)
      .post('/api/merlt/internal/job-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'running' });

    expect(res.status).toBe(200);
    const updated = await prisma.merltIngestionJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe('running');
    expect(updated?.startedAt).not.toBeNull();
    expect(updated?.completedAt).toBeNull();
  });

  it('returns 401 with a wrong secret', async () => {
    const job = await prisma.merltIngestionJob.create({
      data: { articleUrn: 'urn:test:cb-401', userId: user.id, status: 'pending' },
    });

    const res = await request(app)
      .post('/api/merlt/internal/job-callback')
      .set('X-Internal-Secret', 'wrong')
      .send({ bffJobId: job.id, status: 'completed' });

    expect(res.status).toBe(401);
    expect(res.body.detail).toBe('invalid_internal_secret');

    const unchanged = await prisma.merltIngestionJob.findUnique({ where: { id: job.id } });
    expect(unchanged?.status).toBe('pending');
  });

  it('returns 404 when the job id is unknown', async () => {
    const res = await request(app)
      .post('/api/merlt/internal/job-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: '00000000-0000-0000-0000-000000000999', status: 'completed' });

    expect(res.status).toBe(404);
  });
});
