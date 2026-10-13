import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import nock from 'nock';
import {
  request,
  app,
  createTestUser,
  authHeader,
  prisma,
  type TestUser,
  merltNoticeId,
} from '../../helpers';
import { deleteUserAccount } from '../../../src/lingo/deleteUserAccount';
import { backoffMs, processMerltErasures } from '../../../src/services/merlt/userData';

/**
 * MERL-T data protection (spec docs/superpowers/specs/2026-10-13-merlt-data-protection-design.md):
 * consent under a notice version, collection paused by a new version, the person's data
 * exported and erased, an account deletion reaching MERL-T, the retries.
 */

const TEST_MERLT_BASE = 'http://merlt-test.local:8000';

beforeAll(() => {
  process.env.MERLT_API_URL = TEST_MERLT_BASE;
  process.env.MERLT_TIMEOUT_MS = '500';
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
});

async function consent(user: TestUser, level: 'none' | 'basic' | 'full') {
  return request(app)
    .post('/api/merlt/consent')
    .set(authHeader(user))
    .send({ level, noticeId: await merltNoticeId() });
}

async function publishNoticeVersion(versione: number): Promise<string> {
  const row = await prisma.lingoTestoVersione.create({
    data: {
      chiave: 'INFORMATIVA_MERLT',
      versione,
      titolo: 'Informativa nuova',
      corpo: 'Testo nuovo.',
      conferma: 'Ho letto',
      azione: 'Conferma',
    },
  });
  return row.id;
}

const articleViewed = {
  articleUrn: 'urn:nir:stato:codice.civile:1942;2043',
  dwellMs: 4500,
  scrollMaxPct: 60,
  sessionId: '00000000-0000-0000-0000-000000000001',
};

describe('consent under a notice version', () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('privacy-consent');
  });

  it('a fresh account has not answered the notice, and gets it with the consent', async () => {
    const res = await request(app).get('/api/merlt/consent').set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ level: 'none', storedLevel: 'none', noticeAnswered: false });
    expect(res.body.notice).toMatchObject({ id: await merltNoticeId(), versione: 1 });
    expect(res.body.notice.corpo.length).toBeGreaterThan(100);
  });

  it('a choice needs the notice it was made under, and records it', async () => {
    const missing = await request(app).post('/api/merlt/consent').set(authHeader(user)).send({ level: 'basic' });
    expect(missing.status).toBe(400);

    const stale = await request(app)
      .post('/api/merlt/consent')
      .set(authHeader(user))
      .send({ level: 'basic', noticeId: '00000000-0000-0000-0000-000000000000' });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ detail: 'notice_changed', notice: { id: await merltNoticeId() } });
    expect(await prisma.merltUserPreference.count({ where: { userId: user.id } })).toBe(0);

    const ok = await consent(user, 'basic');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ level: 'basic', storedLevel: 'basic', noticeAnswered: true });
    const audit = await prisma.merltConsentAudit.findFirstOrThrow({ where: { userId: user.id } });
    expect(audit.informativaTestoId).toBe(await merltNoticeId());
  });

  it('answering «none» is an answer: the notice is not asked again', async () => {
    const res = await consent(user, 'none');
    expect(res.body).toMatchObject({ level: 'none', noticeAnswered: true });
  });

  it('a new notice version pauses collection until the person answers it', async () => {
    await consent(user, 'full');
    await publishNoticeVersion(2);

    const res = await request(app).get('/api/merlt/consent').set(authHeader(user));
    expect(res.body).toMatchObject({ level: 'none', storedLevel: 'full', noticeAnswered: false, contributionEnabled: false });
    expect(res.body.notice.versione).toBe(2);

    const event = await request(app).post('/api/merlt/events/article-viewed').set(authHeader(user)).send(articleViewed);
    expect(event.status).toBe(403);
    expect(event.body.detail).toBe('consent_required');

    // Answering the new version restores it.
    const again = await consent(user, 'full');
    expect(again.body).toMatchObject({ level: 'full', noticeAnswered: true });
  });

  it('a level from before the notice existed collects nothing', async () => {
    await prisma.merltUserPreference.create({
      data: { userId: user.id, consentLevel: 'full', contributionEnabled: true, validationEnabled: true, graphEnabled: true },
    });
    const res = await request(app).get('/api/merlt/consent').set(authHeader(user));
    expect(res.body).toMatchObject({ level: 'none', storedLevel: 'full', noticeAnswered: false });
    const ner = await request(app).post('/api/merlt/ner/feedback').set(authHeader(user)).send({});
    expect(ner.status).toBe(403);
  });
});

describe("the person's MERL-T data", () => {
  let user: TestUser;
  beforeEach(async () => {
    user = await createTestUser('privacy-data');
    await consent(user, 'basic');
    await prisma.merltQaJob.create({
      data: { userId: user.id, query: 'la mia domanda', mode: 'deliberazione', consentLevel: 'basic', status: 'completed' },
    });
  });

  it('downloads what MERL-T keeps and what this server keeps for it', async () => {
    nock(TEST_MERLT_BASE)
      .get(`/api/v1/user-data/${user.id}`)
      .reply(200, { user_id: user.id, tables: { tracking_events: [{ event_type: 'article:viewed' }] } });
    const res = await request(app).get('/api/merlt/data/export').set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('dati-merlt.json');
    expect(res.body.merlt.tables.tracking_events).toHaveLength(1);
    expect(res.body.visualex.consent).toMatchObject({ consentLevel: 'basic', informativa: { versione: 1 } });
    expect(res.body.visualex.qaJobs[0].query).toBe('la mia domanda');
  });

  it('refuses a download without MERL-T rather than give half of it', async () => {
    nock(TEST_MERLT_BASE).get(`/api/v1/user-data/${user.id}`).reply(503, {});
    const res = await request(app).get('/api/merlt/data/export').set(authHeader(user));
    expect(res.status).toBe(503);
  });

  it('erases: this server at once, MERL-T confirmed, the consent kept', async () => {
    nock(TEST_MERLT_BASE).delete(`/api/v1/user-data/${user.id}`).reply(200, { complete: true });
    const res = await request(app).delete('/api/merlt/data').set(authHeader(user));
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ completed: true });
    expect(await prisma.merltQaJob.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.merltErasureRequest.count({ where: { userId: user.id } })).toBe(0);
    const pref = await prisma.merltUserPreference.findUniqueOrThrow({ where: { userId: user.id } });
    expect(pref.consentLevel).toBe('basic');
  });

  it('keeps the request when MERL-T is down, and the worker finishes it later', async () => {
    nock(TEST_MERLT_BASE).delete(`/api/v1/user-data/${user.id}`).reply(503, { complete: false });
    const res = await request(app).delete('/api/merlt/data').set(authHeader(user));
    expect(res.body).toEqual({ completed: false });
    const pending = await prisma.merltErasureRequest.findFirstOrThrow({ where: { userId: user.id } });
    expect(pending).toMatchObject({ reason: 'user_request', attempts: 1, lastError: 'http_503' });
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Not due yet: the worker leaves it.
    expect(await processMerltErasures()).toBe(0);
    await prisma.merltErasureRequest.update({ where: { id: pending.id }, data: { nextAttemptAt: new Date(0) } });
    nock(TEST_MERLT_BASE).delete(`/api/v1/user-data/${user.id}`).reply(200, { complete: true });
    expect(await processMerltErasures()).toBe(1);
    expect(await prisma.merltErasureRequest.count()).toBe(0);
  });

  it('revoking can erase what was collected', async () => {
    nock(TEST_MERLT_BASE).delete(`/api/v1/user-data/${user.id}`).reply(200, { complete: true });
    const res = await request(app)
      .delete('/api/merlt/consent')
      .set(authHeader(user))
      .send({ deleteData: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ level: 'none', noticeAnswered: true, erasure: { requested: true, completed: true } });
    expect(await prisma.merltQaJob.count({ where: { userId: user.id } })).toBe(0);
  });

  it('revoking alone erases nothing', async () => {
    const res = await request(app).delete('/api/merlt/consent').set(authHeader(user)).send({});
    expect(res.body.erasure).toEqual({ requested: false, completed: false });
    expect(await prisma.merltQaJob.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.merltErasureRequest.count()).toBe(0);
  });
});

describe('an account deletion reaches MERL-T', () => {
  it('records and sends the erasure of a person who consented', async () => {
    const user = await createTestUser('privacy-gone');
    await consent(user, 'basic');
    nock(TEST_MERLT_BASE).delete(`/api/v1/user-data/${user.id}`).reply(503, {});
    await deleteUserAccount(user.id);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
    // MERL-T was down: the request outlives the account, for the worker.
    const pending = await prisma.merltErasureRequest.findFirstOrThrow({ where: { userId: user.id } });
    expect(pending).toMatchObject({ reason: 'account_deleted', attempts: 1 });
  });

  it('a revoked consent still counts: MERL-T may hold what came before', async () => {
    const user = await createTestUser('privacy-revoked');
    await consent(user, 'full');
    await request(app).delete('/api/merlt/consent').set(authHeader(user)).send({});
    nock(TEST_MERLT_BASE).delete(`/api/v1/user-data/${user.id}`).reply(200, { complete: true });
    await deleteUserAccount(user.id);
    expect(await prisma.merltErasureRequest.count()).toBe(0);
  });

  it('asks nothing of MERL-T for a person who never consented', async () => {
    const user = await createTestUser('privacy-never');
    await deleteUserAccount(user.id);
    expect(await prisma.merltErasureRequest.count()).toBe(0);
  });

  it('the account export carries the MERL-T consent and its history', async () => {
    const user = await createTestUser('privacy-export');
    await consent(user, 'basic');
    const res = await request(app).get('/api/auth/export').set(authHeader(user));
    expect(res.body.data.merltConsenso).toMatchObject({ consentLevel: 'basic', informativa: { versione: 1 } });
    expect(res.body.data.merltConsensoStorico).toHaveLength(1);
  });
});

describe('backoffMs', () => {
  it('waits five minutes, then doubles, at most a day', () => {
    expect(backoffMs(1)).toBe(5 * 60 * 1000);
    expect(backoffMs(2)).toBe(10 * 60 * 1000);
    expect(backoffMs(20)).toBe(24 * 60 * 60 * 1000);
  });
});
