import { describe, expect, it, beforeEach } from 'vitest';
import { request, app, createTestUser, authHeader, prisma, type TestUser } from './helpers';

describe('account data controls', () => {
  let alice: TestUser;
  beforeEach(async () => { alice = await createTestUser('account-alice'); });

  it('exports portable data without credentials', async () => {
    const response = await request(app).get('/api/auth/export').set(authHeader(alice));
    expect(response.status).toBe(200);
    expect(response.body.schemaVersion).toBe(1);
    expect(response.body.user).not.toHaveProperty('password');
    expect(response.body.data).toHaveProperty('dossiers');
    expect(response.body.data).toHaveProperty('threads');
  });

  it('requires the current password and exact confirmation before deletion', async () => {
    const rejected = await request(app).delete('/api/auth/account').set(authHeader(alice)).send({ password: 'wrong', confirmation: 'ELIMINA ACCOUNT' });
    expect(rejected.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { id: alice.id } })).not.toBeNull();

    const deleted = await request(app).delete('/api/auth/account').set(authHeader(alice)).send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
    expect(deleted.status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: alice.id } })).toBeNull();
  });
});
