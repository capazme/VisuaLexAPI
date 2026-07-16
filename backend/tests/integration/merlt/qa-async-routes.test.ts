import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import nock from 'nock';
import { request, app, createTestUser, authHeader, prisma, type TestUser } from '../../helpers';
import { _resetExpertsClientForTests } from '../../../src/services/merlt/expertsClient';

// Async progressive Q&A routes (qa-async-progressive-contract.md):
//   POST /api/merlt/experts/query/async   — submit
//   GET  /api/merlt/experts/jobs/:id/status — poll
//   POST /api/merlt/internal/qa-callback  — MERL-T → BFF per-expert/terminal callback

const TEST_MERLT_BASE = 'http://qa-async-test.local:8000';
const INTERNAL_SECRET = 'test-qa-internal-secret';

beforeAll(() => {
  process.env.MERLT_API_URL = TEST_MERLT_BASE;
  process.env.MERLT_EXPERTS_TIMEOUT_MS = '500';
  process.env.MERLT_EXPERTS_ASYNC_TIMEOUT_MS = '500';
  process.env.MERLT_INTERNAL_SECRET = INTERNAL_SECRET;
  _resetExpertsClientForTests();
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
  nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
});
afterEach(() => nock.cleanAll());
afterAll(() => {
  nock.enableNetConnect();
  nock.restore();
  delete process.env.MERLT_API_URL;
  delete process.env.MERLT_EXPERTS_TIMEOUT_MS;
  delete process.env.MERLT_EXPERTS_ASYNC_TIMEOUT_MS;
  delete process.env.MERLT_INTERNAL_SECRET;
});

async function grantFull(user: TestUser): Promise<void> {
  await request(app).post('/api/merlt/consent').set(authHeader(user)).send({ level: 'full' });
}

async function grantBasic(user: TestUser): Promise<void> {
  await request(app).post('/api/merlt/consent').set(authHeader(user)).send({ level: 'basic' });
}

const partial = (expert: 'literal' | 'systemic' | 'principles' | 'precedent', thesis: string) => ({
  expert,
  thesis,
  confidence: 0.7,
  weight: 0.7,
});

describe('POST /api/merlt/experts/query/async (qa-async-progressive-contract.md §1)', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('qa-async-alice');
  });

  it('401 without auth', async () => {
    const res = await request(app)
      .post('/api/merlt/experts/query/async')
      .send({ query: 'art 1453 risoluzione', mode: 'convergent' });
    expect(res.status).toBe(401);
  });

  it('403 without any consent', async () => {
    const res = await request(app)
      .post('/api/merlt/experts/query/async')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione', mode: 'convergent' });
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('consent_required');
  });

  it('202 + creates a pending MerltQaJob row with the correct userId/consentLevel, enqueues bff_job_id to MERL-T', async () => {
    await grantFull(user);
    let sentBody: Record<string, unknown> | undefined;
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/query/async', (b) => {
        sentBody = b as Record<string, unknown>;
        return true;
      })
      .reply(202, { accepted: true, trace_id: 'trace_async_1' });

    const res = await request(app)
      .post('/api/merlt/experts/query/async')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione', mode: 'convergent' });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending');
    expect(res.body.jobId).toBeDefined();

    const job = await prisma.merltQaJob.findUnique({ where: { id: res.body.jobId } });
    expect(job).not.toBeNull();
    expect(job?.userId).toBe(user.id);
    expect(job?.status).toBe('pending');
    expect(job?.consentLevel).toBe('full');
    expect(job?.query).toBe('art 1453 risoluzione');
    expect(job?.mode).toBe('convergent');

    // bff_job_id threaded to MERL-T is the created job's own id.
    expect(sentBody?.bff_job_id).toBe(res.body.jobId);
    expect(sentBody?.user_id).toBe(user.id);
    expect(sentBody?.consent_level).toBe('full');
  });

  it('still returns 202 (best-effort enqueue) when the MERL-T call errors', async () => {
    await grantBasic(user);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/experts/query/async')
      .replyWithError({ code: 'ECONNREFUSED', message: 'down' });

    const res = await request(app)
      .post('/api/merlt/experts/query/async')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione', mode: 'convergent' });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending');
    const job = await prisma.merltQaJob.findUnique({ where: { id: res.body.jobId } });
    expect(job).not.toBeNull();
    expect(job?.status).toBe('pending');
    expect(job?.consentLevel).toBe('basic');
  });

  it('400 on invalid body (missing mode)', async () => {
    await grantFull(user);
    const res = await request(app)
      .post('/api/merlt/experts/query/async')
      .set(authHeader(user))
      .send({ query: 'art 1453 risoluzione' });
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('invalid_body');
  });
});

describe('GET /api/merlt/experts/jobs/:jobId/status (qa-async-progressive-contract.md §2)', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('qa-async-bob');
  });

  it('401 without auth', async () => {
    const res = await request(app).get('/api/merlt/experts/jobs/some-id/status');
    expect(res.status).toBe(401);
  });

  it('returns the contract shape for a pending job owned by the caller', async () => {
    const job = await prisma.merltQaJob.create({
      data: { userId: user.id, query: 'q', mode: 'convergent', consentLevel: 'full', status: 'pending' },
    });
    const res = await request(app)
      .get(`/api/merlt/experts/jobs/${job.id}/status`)
      .set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      jobId: job.id,
      status: 'pending',
      partials: [],
      result: null,
      error: null,
    });
  });

  it('returns partials/result/error when present', async () => {
    const job = await prisma.merltQaJob.create({
      data: {
        userId: user.id,
        query: 'q',
        mode: 'convergent',
        consentLevel: 'full',
        status: 'completed',
        partials: [partial('literal', 'tesi letterale')],
        result: { trace_id: 'trace_x', synthesis: 'La sintesi.' },
      },
    });
    const res = await request(app)
      .get(`/api/merlt/experts/jobs/${job.id}/status`)
      .set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.partials).toEqual([partial('literal', 'tesi letterale')]);
    expect(res.body.result).toEqual({ trace_id: 'trace_x', synthesis: 'La sintesi.' });
    expect(res.body.error).toBeNull();
  });

  it('404 for a job owned by another user (IDOR guard)', async () => {
    const other = await createTestUser('qa-async-bob-other');
    const job = await prisma.merltQaJob.create({
      data: { userId: other.id, query: 'q', mode: 'convergent', consentLevel: 'full', status: 'pending' },
    });
    const res = await request(app)
      .get(`/api/merlt/experts/jobs/${job.id}/status`)
      .set(authHeader(user));
    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('job_not_found');
  });

  it('404 for a nonexistent job id', async () => {
    const res = await request(app)
      .get('/api/merlt/experts/jobs/00000000-0000-0000-0000-000000000999/status')
      .set(authHeader(user));
    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('job_not_found');
  });
});

describe('POST /api/merlt/internal/qa-callback (qa-async-progressive-contract.md §4)', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('qa-async-carol');
  });

  it('401 with a wrong X-Internal-Secret', async () => {
    const job = await prisma.merltQaJob.create({
      data: { userId: user.id, query: 'q', mode: 'convergent', consentLevel: 'full', status: 'pending' },
    });
    const res = await request(app)
      .post('/api/merlt/internal/qa-callback')
      .set('X-Internal-Secret', 'wrong-secret')
      .send({ bffJobId: job.id, status: 'completed', result: {} });
    expect(res.status).toBe(401);
    expect(res.body.detail).toBe('invalid_internal_secret');
    const unchanged = await prisma.merltQaJob.findUnique({ where: { id: job.id } });
    expect(unchanged?.status).toBe('pending');
  });

  it('running + partialExpert appends the first partial and stamps startedAt', async () => {
    const job = await prisma.merltQaJob.create({
      data: { userId: user.id, query: 'q', mode: 'convergent', consentLevel: 'full', status: 'pending' },
    });
    const res = await request(app)
      .post('/api/merlt/internal/qa-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'running', partialExpert: partial('literal', 'tesi letterale') });
    expect(res.status).toBe(200);
    const updated = await prisma.merltQaJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe('running');
    expect(updated?.startedAt).not.toBeNull();
    expect(updated?.completedAt).toBeNull();
    expect(updated?.partials).toEqual([partial('literal', 'tesi letterale')]);
  });

  it('two out-of-order partials (precedent then literal) stay canon-ordered [literal, precedent]', async () => {
    const job = await prisma.merltQaJob.create({
      data: { userId: user.id, query: 'q', mode: 'divergent', consentLevel: 'full', status: 'pending' },
    });
    await request(app)
      .post('/api/merlt/internal/qa-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'running', partialExpert: partial('precedent', 'tesi precedente') });
    const res = await request(app)
      .post('/api/merlt/internal/qa-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'running', partialExpert: partial('literal', 'tesi letterale') });
    expect(res.status).toBe(200);
    const updated = await prisma.merltQaJob.findUnique({ where: { id: job.id } });
    const experts = (updated?.partials as { expert: string }[]).map((p) => p.expert);
    expect(experts).toEqual(['literal', 'precedent']);
  });

  it('dedupes on a repeated expert (replaces, does not append a duplicate)', async () => {
    const job = await prisma.merltQaJob.create({
      data: { userId: user.id, query: 'q', mode: 'convergent', consentLevel: 'full', status: 'pending' },
    });
    await request(app)
      .post('/api/merlt/internal/qa-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'running', partialExpert: partial('literal', 'prima bozza') });
    const res = await request(app)
      .post('/api/merlt/internal/qa-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'running', partialExpert: partial('literal', 'tesi finale') });
    expect(res.status).toBe(200);
    const updated = await prisma.merltQaJob.findUnique({ where: { id: job.id } });
    const partials = updated?.partials as { expert: string; thesis: string }[];
    expect(partials).toHaveLength(1);
    expect(partials[0].thesis).toBe('tesi finale');
  });

  it('completed sets result + status + completedAt', async () => {
    const job = await prisma.merltQaJob.create({
      data: {
        userId: user.id,
        query: 'q',
        mode: 'convergent',
        consentLevel: 'full',
        status: 'running',
        partials: [partial('literal', 'tesi letterale')],
      },
    });
    const result = { trace_id: 'trace_final', synthesis: 'La sintesi finale.', confidence: 0.8 };
    const res = await request(app)
      .post('/api/merlt/internal/qa-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'completed', result });
    expect(res.status).toBe(200);
    const updated = await prisma.merltQaJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe('completed');
    expect(updated?.result).toEqual(result);
    expect(updated?.completedAt).not.toBeNull();
  });

  // FIX 3a: traceId column is populated from result.trace_id on the terminal
  // completed callback (previously always null).
  it('completed populates the traceId column from result.trace_id', async () => {
    const job = await prisma.merltQaJob.create({
      data: { userId: user.id, query: 'q', mode: 'convergent', consentLevel: 'full', status: 'running' },
    });
    const result = { trace_id: 'trace_populate_me', synthesis: 'La sintesi.' };
    const res = await request(app)
      .post('/api/merlt/internal/qa-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'completed', result });
    expect(res.status).toBe(200);
    const updated = await prisma.merltQaJob.findUnique({ where: { id: job.id } });
    expect(updated?.traceId).toBe('trace_populate_me');
  });

  it('completed without a trace_id in result leaves traceId null (non-fatal)', async () => {
    const job = await prisma.merltQaJob.create({
      data: { userId: user.id, query: 'q', mode: 'convergent', consentLevel: 'full', status: 'running' },
    });
    const res = await request(app)
      .post('/api/merlt/internal/qa-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'completed', result: { synthesis: 'no trace here' } });
    expect(res.status).toBe(200);
    const updated = await prisma.merltQaJob.findUnique({ where: { id: job.id } });
    expect(updated?.traceId).toBeNull();
  });

  // FIX 3b: a running callback with a non-canonical expert_type must not 400
  // the whole callback — the merge is skipped, the callback is still
  // acknowledged 200, and startedAt is still stamped.
  it('running + partialExpert with a non-canonical expert_type is skipped but returns 200', async () => {
    const job = await prisma.merltQaJob.create({
      data: { userId: user.id, query: 'q', mode: 'convergent', consentLevel: 'full', status: 'pending' },
    });
    const res = await request(app)
      .post('/api/merlt/internal/qa-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({
        bffJobId: job.id,
        status: 'running',
        partialExpert: { expert: 'not_a_canon_expert', thesis: 'x', confidence: 0.5, weight: 0.5 },
      });
    expect(res.status).toBe(200);
    const updated = await prisma.merltQaJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe('running');
    expect(updated?.startedAt).not.toBeNull();
    expect(updated?.partials).toBeNull();
  });

  it('running with a canonical partial after a skipped non-canonical one still merges correctly', async () => {
    const job = await prisma.merltQaJob.create({
      data: { userId: user.id, query: 'q', mode: 'convergent', consentLevel: 'full', status: 'pending' },
    });
    await request(app)
      .post('/api/merlt/internal/qa-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({
        bffJobId: job.id,
        status: 'running',
        partialExpert: { expert: 'garbage', thesis: 'x', confidence: 0.5, weight: 0.5 },
      });
    const res = await request(app)
      .post('/api/merlt/internal/qa-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'running', partialExpert: partial('systemic', 'tesi sistematica') });
    expect(res.status).toBe(200);
    const updated = await prisma.merltQaJob.findUnique({ where: { id: job.id } });
    expect(updated?.partials).toEqual([partial('systemic', 'tesi sistematica')]);
  });

  it('failed sets error + status + completedAt', async () => {
    const job = await prisma.merltQaJob.create({
      data: { userId: user.id, query: 'q', mode: 'convergent', consentLevel: 'full', status: 'running' },
    });
    const res = await request(app)
      .post('/api/merlt/internal/qa-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'failed', error: 'orchestrator crashed' });
    expect(res.status).toBe(200);
    const updated = await prisma.merltQaJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe('failed');
    expect(updated?.errorMessage).toBe('orchestrator crashed');
    expect(updated?.completedAt).not.toBeNull();
  });

  it('timeout sets error + status + completedAt', async () => {
    const job = await prisma.merltQaJob.create({
      data: { userId: user.id, query: 'q', mode: 'convergent', consentLevel: 'full', status: 'running' },
    });
    const res = await request(app)
      .post('/api/merlt/internal/qa-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'timeout', error: 'deliberation exceeded budget' });
    expect(res.status).toBe(200);
    const updated = await prisma.merltQaJob.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe('timeout');
    expect(updated?.errorMessage).toBe('deliberation exceeded budget');
    expect(updated?.completedAt).not.toBeNull();
  });

  it('a callback for an already-terminal job is a no-op acknowledged 200', async () => {
    const job = await prisma.merltQaJob.create({
      data: {
        userId: user.id,
        query: 'q',
        mode: 'convergent',
        consentLevel: 'full',
        status: 'completed',
        result: { trace_id: 'trace_x', synthesis: 'x' },
        completedAt: new Date(),
      },
    });
    const res = await request(app)
      .post('/api/merlt/internal/qa-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: job.id, status: 'running', partialExpert: partial('literal', 'late arrival') });
    expect(res.status).toBe(200);
    const unchanged = await prisma.merltQaJob.findUnique({ where: { id: job.id } });
    expect(unchanged?.status).toBe('completed');
    expect(unchanged?.result).toEqual({ trace_id: 'trace_x', synthesis: 'x' });
  });

  it('an unknown bffJobId is acknowledged 200 (best-effort, never surfaces as an error)', async () => {
    const res = await request(app)
      .post('/api/merlt/internal/qa-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ bffJobId: '00000000-0000-0000-0000-000000000999', status: 'completed', result: {} });
    expect(res.status).toBe(200);
  });

  it('400 on invalid body (missing bffJobId)', async () => {
    const res = await request(app)
      .post('/api/merlt/internal/qa-callback')
      .set('X-Internal-Secret', INTERNAL_SECRET)
      .send({ status: 'completed' });
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('invalid_body');
  });
});
