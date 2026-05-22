import { describe, it, expect, beforeEach } from 'vitest';
import { request, app, createTestUser, authHeader, prisma, type TestUser } from '../../helpers';

describe('MERL-T consent API (MERLT-1.4)', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser('consent-alice');
  });

  describe('GET /api/merlt/consent', () => {
    it('returns level=none + all toggles off for a fresh user', async () => {
      const res = await request(app)
        .get('/api/merlt/consent')
        .set(authHeader(user));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        level: 'none',
        contributionEnabled: false,
        validationEnabled: false,
        graphEnabled: false,
        updatedAt: null,
        lastAuditAt: null,
      });
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/merlt/consent');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/merlt/consent', () => {
    it('sets level=basic, returns derived toggles, writes audit row', async () => {
      const res = await request(app)
        .post('/api/merlt/consent')
        .set(authHeader(user))
        .send({ level: 'basic' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        level: 'basic',
        contributionEnabled: false,
        validationEnabled: false,
        graphEnabled: true,
      });
      expect(res.body.updatedAt).toBeTruthy();
      expect(res.body.lastAuditAt).toBeTruthy();

      // Audit row check
      const audits = await prisma.merltConsentAudit.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        userId: user.id,
        previousLevel: null,
        nextLevel: 'basic',
        source: 'user',
      });
    });

    it('sets level=full and turns ALL toggles on', async () => {
      const res = await request(app)
        .post('/api/merlt/consent')
        .set(authHeader(user))
        .send({ level: 'full', reason: 'training mode opt-in' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        level: 'full',
        contributionEnabled: true,
        validationEnabled: true,
        graphEnabled: true,
      });

      const audit = await prisma.merltConsentAudit.findFirst({
        where: { userId: user.id },
      });
      expect(audit?.reason).toBe('training mode opt-in');
    });

    it('records previousLevel correctly on upgrade basic → full', async () => {
      await request(app)
        .post('/api/merlt/consent')
        .set(authHeader(user))
        .send({ level: 'basic' });

      await request(app)
        .post('/api/merlt/consent')
        .set(authHeader(user))
        .send({ level: 'full' });

      const audits = await prisma.merltConsentAudit.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audits).toHaveLength(2);
      expect(audits[0]).toMatchObject({ previousLevel: null, nextLevel: 'basic' });
      expect(audits[1]).toMatchObject({ previousLevel: 'basic', nextLevel: 'full' });
    });

    it('returns 400 on invalid level', async () => {
      const res = await request(app)
        .post('/api/merlt/consent')
        .set(authHeader(user))
        .send({ level: 'partial' });

      expect(res.status).toBe(400);
      expect(res.body.detail).toBe('invalid_body');
    });

    it('returns 400 when level is missing', async () => {
      const res = await request(app)
        .post('/api/merlt/consent')
        .set(authHeader(user))
        .send({ reason: 'whatever' });

      expect(res.status).toBe(400);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(app)
        .post('/api/merlt/consent')
        .send({ level: 'basic' });
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/merlt/consent', () => {
    it('revokes consent (level → none), preserves audit history', async () => {
      // Setup: user is at level=full
      await request(app)
        .post('/api/merlt/consent')
        .set(authHeader(user))
        .send({ level: 'full' });

      const res = await request(app)
        .delete('/api/merlt/consent')
        .set(authHeader(user))
        .send({ reason: 'changed my mind' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        level: 'none',
        contributionEnabled: false,
        validationEnabled: false,
        graphEnabled: false,
      });

      const audits = await prisma.merltConsentAudit.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audits).toHaveLength(2);
      expect(audits[1]).toMatchObject({
        previousLevel: 'full',
        nextLevel: 'none',
        reason: 'changed my mind',
      });
    });

    it('accepts empty body (no reason)', async () => {
      await request(app)
        .post('/api/merlt/consent')
        .set(authHeader(user))
        .send({ level: 'basic' });

      const res = await request(app)
        .delete('/api/merlt/consent')
        .set(authHeader(user));

      expect(res.status).toBe(200);
      expect(res.body.level).toBe('none');
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(app).delete('/api/merlt/consent');
      expect(res.status).toBe(401);
    });
  });

  describe('full consent lifecycle', () => {
    it('none → basic → full → none with 3 audit rows', async () => {
      // 1. Initial GET → none
      const r1 = await request(app)
        .get('/api/merlt/consent')
        .set(authHeader(user));
      expect(r1.body.level).toBe('none');

      // 2. POST basic
      await request(app)
        .post('/api/merlt/consent')
        .set(authHeader(user))
        .send({ level: 'basic' });

      // 3. POST full
      await request(app)
        .post('/api/merlt/consent')
        .set(authHeader(user))
        .send({ level: 'full' });

      // 4. DELETE
      await request(app)
        .delete('/api/merlt/consent')
        .set(authHeader(user));

      // 5. GET again → none
      const r5 = await request(app)
        .get('/api/merlt/consent')
        .set(authHeader(user));
      expect(r5.body.level).toBe('none');
      expect(r5.body.lastAuditAt).toBeTruthy();

      // 6. Audit trail
      const audits = await prisma.merltConsentAudit.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audits.map((a) => `${a.previousLevel ?? 'null'}→${a.nextLevel}`)).toEqual([
        'null→basic',
        'basic→full',
        'full→none',
      ]);
    });
  });
});
