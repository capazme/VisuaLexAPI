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
import { _resetContribClientForTests } from '../../../src/routes/merlt/contrib';

const TEST_MERLT_BASE = 'http://merlt-test.local:8000';
const INTERNAL_SECRET = 'test-internal-secret';

beforeAll(() => {
  process.env.MERLT_API_URL = TEST_MERLT_BASE;
  process.env.MERLT_TIMEOUT_MS = '500';
  process.env.MERLT_CONTRIB_TIMEOUT_MS = '500';
  process.env.MERLT_INTERNAL_SECRET = INTERNAL_SECRET;
  _resetContribClientForTests();
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
  delete process.env.MERLT_INTERNAL_SECRET;
});

async function grantFull(user: TestUser): Promise<void> {
  await request(app).post('/api/merlt/consent').set(authHeader(user)).send({ level: 'full' });
}

describe('POST /api/merlt/contrib/documents (upload)', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('contrib-upload');
  });

  it('403s without full consent', async () => {
    const res = await request(app)
      .post('/api/merlt/contrib/documents')
      .set(authHeader(user))
      .attach('file', Buffer.from('appunti'), { filename: 'note.txt', contentType: 'text/plain' });
    expect(res.status).toBe(403);
  });

  it('400s when no file is attached', async () => {
    await grantFull(user);
    const res = await request(app).post('/api/merlt/contrib/documents').set(authHeader(user));
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('file_required');
  });

  it('400s on an unsupported file type', async () => {
    await grantFull(user);
    const res = await request(app)
      .post('/api/merlt/contrib/documents')
      .set(authHeader(user))
      .attach('file', Buffer.from('x'), { filename: 'malware.exe', contentType: 'application/octet-stream' });
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('invalid_file');
  });

  it('forwards a valid file to MERL-T and returns the document id (201)', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).post('/api/v1/documents/upload').reply(200, { document_id: 99 });
    const res = await request(app)
      .post('/api/merlt/contrib/documents')
      .set(authHeader(user))
      .attach('file', Buffer.from('i miei appunti'), { filename: 'note.txt', contentType: 'text/plain' });
    expect(res.status).toBe(201);
    expect(res.body.documentId).toBe(99);
  });
});

describe('POST /api/merlt/contrib/documents/:id/extract', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('contrib-alice');
  });

  it('403s without full (contribution) consent', async () => {
    const res = await request(app)
      .post('/api/merlt/contrib/documents/42/extract')
      .set(authHeader(user));
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('contribution_consent_required');
  });

  it('creates a job and enqueues the extraction (202)', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/documents/42/extract-async')
      .reply(202, { task_id: 'task-xyz' });

    const res = await request(app)
      .post('/api/merlt/contrib/documents/42/extract')
      .set(authHeader(user));

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeTruthy();
    const job = await prisma.merltExtractionJob.findUnique({ where: { id: res.body.jobId } });
    expect(job?.taskId).toBe('task-xyz');
    expect(job?.userId).toBe(user.id);
  });

  it('still returns the job when MERL-T enqueue fails', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).post('/api/v1/documents/42/extract-async').reply(503, 'down');
    const res = await request(app)
      .post('/api/merlt/contrib/documents/42/extract')
      .set(authHeader(user));
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeTruthy();
  });
});

describe('GET /api/merlt/contrib/documents/:id/candidates', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('contrib-bob');
  });

  it('proxies candidates scoped to the contributor', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .get('/api/v1/documents/42/candidates')
      .query((q) => q.contributor_id === user.id)
      .reply(200, { candidates: [{ id: 1, candidate_type: 'entity', entity_text: 'X' }] });

    const res = await request(app)
      .get('/api/merlt/contrib/documents/42/candidates')
      .set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
  });

  it('503s when MERL-T is unavailable', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).get('/api/v1/documents/42/candidates').query(true).reply(500, 'boom');
    const res = await request(app)
      .get('/api/merlt/contrib/documents/42/candidates')
      .set(authHeader(user));
    expect(res.status).toBe(503);
  });
});

describe('GET /api/merlt/contrib/jobs/:jobId/status', () => {
  it('is owner-scoped (404 for another user)', async () => {
    const owner = await createTestUser('contrib-owner');
    const other = await createTestUser('contrib-other');
    const job = await prisma.merltExtractionJob.create({
      data: { documentId: '42', userId: owner.id, status: 'pending' },
    });

    const ok = await request(app)
      .get(`/api/merlt/contrib/jobs/${job.id}/status`)
      .set(authHeader(owner));
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('pending');

    const denied = await request(app)
      .get(`/api/merlt/contrib/jobs/${job.id}/status`)
      .set(authHeader(other));
    expect(denied.status).toBe(404);
  });
});

describe('POST /api/merlt/contrib/candidates/:id/promote', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('contrib-carol');
  });

  const entityBody = {
    candidateType: 'entity' as const,
    articleUrn: 'urn:test',
    nome: 'Risoluzione',
    tipo: 'concetto',
    descrizione: 'La risoluzione estingue il contratto con effetto retroattivo.',
    fonte: 'Torrente, Manuale, p.120',
    attested: true,
  };

  it('rejects (422) when attestation is missing — no proposal is made', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .get('/api/v1/candidates/7')
      .reply(200, { id: 7, candidate_type: 'entity', verbatim_excerpt: 'raw verbatim' });

    const res = await request(app)
      .post('/api/merlt/contrib/candidates/7/promote')
      .set(authHeader(user))
      .send({ ...entityBody, attested: false });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ detail: 'promotion_rejected', reason: 'not_attested' });
  });

  it('rejects (422) when the text equals the verbatim excerpt', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .get('/api/v1/candidates/7')
      .reply(200, { id: 7, candidate_type: 'entity', verbatim_excerpt: entityBody.descrizione });

    const res = await request(app)
      .post('/api/merlt/contrib/candidates/7/promote')
      .set(authHeader(user))
      .send(entityBody);

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('not_reformulated');
  });

  it('promotes a valid entity → pending proposal (200)', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE)
      .get('/api/v1/candidates/7')
      .reply(200, { id: 7, candidate_type: 'entity', verbatim_excerpt: 'raw verbatim text' });
    nock(TEST_MERLT_BASE)
      .post('/api/v1/enrichment/propose-entity', (b) => (b as { contributed_by: string }).contributed_by === user.id)
      .reply(200, { pending_id: 'pe-99', entity_id: 'ent-1' });
    nock(TEST_MERLT_BASE).post('/api/v1/candidates/7/mark-promoted').reply(200, { ok: true });

    const res = await request(app)
      .post('/api/merlt/contrib/candidates/7/promote')
      .set(authHeader(user))
      .send(entityBody);

    expect(res.status).toBe(200);
    expect(res.body.pendingId).toBe('pe-99');
  });

  it('403s without full consent', async () => {
    const res = await request(app)
      .post('/api/merlt/contrib/candidates/7/promote')
      .set(authHeader(user))
      .send(entityBody);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/merlt/internal/extraction-callback', () => {
  it('updates the job with the worker secret, rejects a wrong secret', async () => {
    const owner = await createTestUser('contrib-dora');
    const job = await prisma.merltExtractionJob.create({
      data: { documentId: '42', userId: owner.id, status: 'pending' },
    });

    const bad = await request(app)
      .post('/api/merlt/internal/extraction-callback')
      .set('X-Internal-Secret', 'wrong')
      .send({ bffJobId: job.id, status: 'completed', candidatesCreated: 3 });
    expect(bad.status).toBe(401);

    const ok = await request(app)
      .post('/api/merlt/internal/extraction-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'completed', candidatesCreated: 3 });
    expect(ok.status).toBe(200);

    const updated = await prisma.merltExtractionJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe('completed');
    expect(updated?.candidatesCreated).toBe(3);
    expect(updated?.completedAt).not.toBeNull();
  });

  it('accepts the worker payload with explicit null fields (regression: job stuck pending)', async () => {
    // The worker serializes absent fields as explicit null (candidatesCreated/error).
    // The schema must use .nullish() (not .optional()) or the completion callback
    // 400s and the job is stuck 'pending' forever — extraction never shows as done.
    const owner = await createTestUser('contrib-nullcb');
    const job = await prisma.merltExtractionJob.create({
      data: { documentId: '99', userId: owner.id, status: 'pending' },
    });

    const res = await request(app)
      .post('/api/merlt/internal/extraction-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'completed', candidatesCreated: null, error: null });
    expect(res.status).toBe(200);

    const updated = await prisma.merltExtractionJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe('completed');
    expect(updated?.completedAt).not.toBeNull();
  });
});
