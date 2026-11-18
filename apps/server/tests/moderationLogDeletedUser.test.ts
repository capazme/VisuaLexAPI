import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { sweepCommunity } from '../src/forum/sweep';
import { app, authHeader, createTestUser, request, type TestUser } from './helpers';

/**
 * The moderation log after an account is deleted (G-504): the act stays, and the person it was about becomes
 * «utente cancellato». The person who did the act already becomes nobody (the actor's foreign key is set to null).
 */
const DELETED = 'utente cancellato';

async function deleteAccount(user: TestUser) {
  const deleted = await request(app).delete('/api/auth/account').set(authHeader(user))
    .send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
  expect(deleted.status).toBe(204);
}

const log = (data: { actorId?: string | null; action: string; targetKind: string; targetId: string; reason?: string }) =>
  prisma.forumModerationLog.create({ data: { reason: 'Motivo del moderatore', ...data } });

describe('deleting an account', () => {
  it('turns the person into «utente cancellato» wherever the log names them, and keeps every act', async () => {
    const [owner, maria, other] = await Promise.all(['mlog-owner', 'mlog-maria', 'mlog-other'].map((name) => createTestUser(name)));
    const profile = await prisma.forumProfile.create({
      data: { userId: maria.id, identity: 'pseudonym', pseudonym: 'Civilista7', qualification: 'altro' },
    });
    const appointed = await log({ actorId: owner.id, action: 'appoint_moderator', targetKind: 'user', targetId: maria.id });
    const nameWithdrawn = await log({ actorId: owner.id, action: 'withdraw_name', targetKind: 'profile', targetId: profile.id });
    const reportDismissed = await log({ actorId: owner.id, action: 'dismiss', targetKind: 'report', targetId: `profile:${profile.id}` });
    const someoneElse = await log({ actorId: owner.id, action: 'appoint_moderator', targetKind: 'user', targetId: other.id });

    await deleteAccount(maria);

    const row = (id: string) => prisma.forumModerationLog.findUniqueOrThrow({ where: { id } });
    expect(await row(appointed.id)).toMatchObject({
      targetId: DELETED, targetKind: 'user', action: 'appoint_moderator', actorId: owner.id, reason: 'Motivo del moderatore',
      createdAt: appointed.createdAt,
    });
    expect(await row(nameWithdrawn.id)).toMatchObject({ targetId: DELETED, targetKind: 'profile', action: 'withdraw_name' });
    expect(await row(reportDismissed.id)).toMatchObject({ targetId: `profile:${DELETED}`, targetKind: 'report', action: 'dismiss' });
    expect((await row(someoneElse.id)).targetId).toBe(other.id);
    expect(await prisma.forumModerationLog.count({ where: { targetId: { contains: maria.id } } })).toBe(0);
    expect(await prisma.forumModerationLog.count({ where: { targetId: { contains: profile.id } } })).toBe(0);
  });

  it('keeps the acts the person did, without them (the actor was already set to nobody)', async () => {
    const [moderator, author] = await Promise.all(['mlog-moderator', 'mlog-author'].map((name) => createTestUser(name)));
    const act = await log({ actorId: moderator.id, action: 'hide', targetKind: 'thread', targetId: randomUUID() });
    const onAuthor = await log({ actorId: moderator.id, action: 'appoint_validator', targetKind: 'user', targetId: author.id });
    await deleteAccount(moderator);
    expect(await prisma.forumModerationLog.findUniqueOrThrow({ where: { id: act.id } })).toMatchObject({ actorId: null, action: 'hide' });
    expect((await prisma.forumModerationLog.findUniqueOrThrow({ where: { id: onAuthor.id } })).targetId).toBe(author.id);
  });
});

describe('the sweep', () => {
  it('repairs the log rows of accounts deleted before, or by any other way, and touches nothing else', async () => {
    const [owner, living] = await Promise.all(['mlog-sweep-owner', 'mlog-sweep-living'].map((name) => createTestUser(name)));
    const livingProfile = await prisma.forumProfile.create({
      data: { userId: living.id, identity: 'pseudonym', pseudonym: 'Vivente1', qualification: 'altro' },
    });
    const gone = randomUUID();
    const goneProfile = randomUUID();
    const threadId = randomUUID();
    const rows = await Promise.all([
      log({ actorId: owner.id, action: 'appoint_moderator', targetKind: 'user', targetId: gone }),
      log({ actorId: owner.id, action: 'withdraw_name', targetKind: 'profile', targetId: goneProfile }),
      log({ actorId: owner.id, action: 'dismiss', targetKind: 'report', targetId: `profile:${goneProfile}` }),
      log({ actorId: owner.id, action: 'appoint_moderator', targetKind: 'user', targetId: living.id }),
      log({ actorId: owner.id, action: 'withdraw_name', targetKind: 'profile', targetId: livingProfile.id }),
      log({ actorId: owner.id, action: 'dismiss', targetKind: 'report', targetId: `profile:${livingProfile.id}` }),
      log({ actorId: owner.id, action: 'dismiss', targetKind: 'report', targetId: `thread:${threadId}` }),
      log({ actorId: owner.id, action: 'hide', targetKind: 'thread', targetId: threadId }),
    ]);

    expect(await sweepCommunity()).toMatchObject({ moderationTargets: 1 });

    // A profile id that no longer exists stays: it may be a living person's old one (see the next test).
    const targets = await Promise.all(rows.map(async (r) => (await prisma.forumModerationLog.findUniqueOrThrow({ where: { id: r.id } })).targetId));
    expect(targets).toEqual([
      DELETED, goneProfile, `profile:${goneProfile}`,
      living.id, livingProfile.id, `profile:${livingProfile.id}`, `thread:${threadId}`, threadId,
    ]);

    // Nothing left to repair: a second pass touches nothing.
    expect(await sweepCommunity()).toMatchObject({ moderationTargets: 0 });
  });

  it('never calls «utente cancellato» a person whose profile took a new id on a move to a pseudonym', async () => {
    const [owner, giulia] = await Promise.all(['mlog-renew-owner', 'mlog-renew-giulia'].map((name) => createTestUser(name)));
    const put = (body: object) => request(app).put('/api/forum/profile').set(authHeader(giulia)).send(body);
    expect((await put({ identity: 'real_name', realName: 'Giulia Verdi', qualification: 'avvocato', materie: [] })).status).toBe(200);
    const before = await prisma.forumProfile.findUniqueOrThrow({ where: { userId: giulia.id } });
    const restored = await log({ actorId: owner.id, action: 'restore_name', targetKind: 'profile', targetId: before.id });
    const report = await log({ actorId: owner.id, action: 'dismiss', targetKind: 'report', targetId: `profile:${before.id}` });

    expect((await put({ identity: 'pseudonym', pseudonym: 'civilista77', qualification: 'avvocato', materie: [] })).status).toBe(200);
    const after = await prisma.forumProfile.findUniqueOrThrow({ where: { userId: giulia.id } });
    expect(after.id).not.toBe(before.id);

    await sweepCommunity();
    expect((await prisma.forumModerationLog.findUniqueOrThrow({ where: { id: restored.id } })).targetId).toBe(before.id);
    expect((await prisma.forumModerationLog.findUniqueOrThrow({ where: { id: report.id } })).targetId).toBe(`profile:${before.id}`);
  });
});
