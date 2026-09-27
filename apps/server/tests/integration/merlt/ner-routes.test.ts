import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import nock from 'nock';
import { request, app, createTestUser, authHeader, prisma, type TestUser } from '../../helpers';
import { _resetNerClientForTests } from '../../../src/services/merlt/nerClient';

const TEST_MERLT_BASE = 'http://ner-routes-test.local:8000';

beforeAll(() => {
  process.env.MERLT_API_URL = TEST_MERLT_BASE;
  process.env.MERLT_NER_TIMEOUT_MS = '500';
  _resetNerClientForTests();
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
  nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
});
afterEach(() => nock.cleanAll());
afterAll(() => {
  nock.enableNetConnect();
  nock.restore();
  delete process.env.MERLT_API_URL;
  delete process.env.MERLT_NER_TIMEOUT_MS;
});

async function grantFull(user: TestUser): Promise<void> {
  await request(app).post('/api/merlt/consent').set(authHeader(user)).send({ level: 'full' });
}

const FEEDBACK_OK = { received: true, feedback_id: 'ner-deadbeef', sample_weight: 1.0 };

describe('MERL-T NER routes (Loop β #2)', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('ner-alice');
  });

  it('401 without auth', async () => {
    const res = await request(app)
      .post('/api/merlt/ner/feedback')
      .send({ surface: 'article_xref', feedbackType: 'confirmation' });
    expect(res.status).toBe(401);
  });

  it('403 without full (contribution) consent', async () => {
    const res = await request(app)
      .post('/api/merlt/ner/feedback')
      .set(authHeader(user))
      .send({ surface: 'article_xref', feedbackType: 'confirmation' });
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('contribution_consent_required');
  });

  it('400 on invalid surface', async () => {
    await grantFull(user);
    const res = await request(app)
      .post('/api/merlt/ner/feedback')
      .set(authHeader(user))
      .send({ surface: 'nope', feedbackType: 'confirmation' });
    expect(res.status).toBe(400);
  });

  it('400 when correction is missing correctReference', async () => {
    await grantFull(user);
    const res = await request(app)
      .post('/api/merlt/ner/feedback')
      .set(authHeader(user))
      .send({ surface: 'article_xref', feedbackType: 'correction' });
    expect(res.status).toBe(400);
  });

  it('202 happy path: injects user_id, maps camelCase → snake_case, caps context_window', async () => {
    await grantFull(user);
    const longContext = 'x'.repeat(2000);
    nock(TEST_MERLT_BASE)
      .post('/api/v1/ner/feedback', (b) => {
        const body = b as {
          user_id: string;
          source_surface: string;
          feedback_type: string;
          article_urn: string;
          start_offset: number;
          context_window: string;
          correct_reference: { actType: string };
        };
        return (
          body.user_id === user.id &&
          body.source_surface === 'article_xref' &&
          body.feedback_type === 'correction' &&
          body.article_urn === 'urn:nir:..~art1453' &&
          body.start_offset === 10 &&
          body.context_window.length === 1200 &&
          body.correct_reference.actType === 'codice civile'
        );
      })
      .reply(200, FEEDBACK_OK);
    const res = await request(app)
      .post('/api/merlt/ner/feedback')
      .set(authHeader(user))
      .send({
        surface: 'article_xref',
        feedbackType: 'correction',
        articleUrn: 'urn:nir:..~art1453',
        selectedText: 'art. 1453',
        startOffset: 10,
        endOffset: 19,
        contextWindow: longContext,
        correctReference: { actType: 'codice civile', article: '1453' },
        confidenceBefore: 0.4,
      });
    expect(res.status).toBe(202);
    expect(res.body.received).toBe(true);
    expect(res.body.feedback_id).toBe('ner-deadbeef');
  });

  it('503 when MERL-T is unavailable (5xx)', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).post('/api/v1/ner/feedback').reply(502, 'down');
    const res = await request(app)
      .post('/api/merlt/ner/feedback')
      .set(authHeader(user))
      .send({ surface: 'qa_chip', feedbackType: 'confirmation' });
    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });

  it('passes through a MERL-T 4xx', async () => {
    await grantFull(user);
    nock(TEST_MERLT_BASE).post('/api/v1/ner/feedback').reply(422, { detail: 'invalid feedback_type upstream' });
    const res = await request(app)
      .post('/api/merlt/ner/feedback')
      .set(authHeader(user))
      .send({ surface: 'qa_chip', feedbackType: 'confirmation' });
    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('invalid feedback_type upstream');
  });

  it('stats requires admin (403 for a non-admin full-consent user)', async () => {
    await grantFull(user);
    const res = await request(app).get('/api/merlt/ner/feedback/stats').set(authHeader(user));
    expect(res.status).toBe(403);
  });

  it('stats proxies MERL-T for an admin', async () => {
    await grantFull(user);
    await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
    nock(TEST_MERLT_BASE)
      .get('/api/v1/ner/feedback/stats')
      .reply(200, { total: 5, untrained: 5, by_type: { confirmation: 5 }, by_surface: { article_xref: 5 } });
    const res = await request(app).get('/api/merlt/ner/feedback/stats').set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
  });
});

describe('MERL-T NER training routes (Loop β #2 Phase 4)', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('ner-train-alice');
  });

  it('401 without auth', async () => {
    const res = await request(app).post('/api/merlt/ner/training/start').send({});
    expect(res.status).toBe(401);
  });

  it('403 for a non-admin user', async () => {
    const res = await request(app).post('/api/merlt/ner/training/start').set(authHeader(user)).send({});
    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('admin_required');
  });

  it('202 enqueues training for an admin and forwards nIter → n_iter', async () => {
    await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
    nock(TEST_MERLT_BASE)
      .post('/api/v1/ner/training/start', (b) => (b as { n_iter: number }).n_iter === 50)
      .reply(202, { task_id: 'ner-train-xyz', status: 'queued' });
    const res = await request(app)
      .post('/api/merlt/ner/training/start')
      .set(authHeader(user))
      .send({ nIter: 50 });
    expect(res.status).toBe(202);
    expect(res.body.task_id).toBe('ner-train-xyz');
  });

  it('job status proxies MERL-T for an admin', async () => {
    await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
    nock(TEST_MERLT_BASE)
      .get('/api/v1/ner/training/jobs/ner-train-xyz')
      .reply(200, { task_id: 'ner-train-xyz', status: 'finished', result: { trained: true, examples: 10 } });
    const res = await request(app).get('/api/merlt/ner/training/jobs/ner-train-xyz').set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('finished');
    expect(res.body.result.examples).toBe(10);
  });

  it('job status 404 passthrough from MERL-T', async () => {
    await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
    nock(TEST_MERLT_BASE).get('/api/v1/ner/training/jobs/nope').reply(404, { detail: 'job_not_found' });
    const res = await request(app).get('/api/merlt/ner/training/jobs/nope').set(authHeader(user));
    expect(res.status).toBe(404);
  });
});
