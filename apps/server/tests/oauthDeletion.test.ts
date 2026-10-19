import { beforeEach, describe, expect, it } from 'vitest';
import { request, app, createTestUser, authHeader, prisma, type TestUser } from './helpers';

// Every OAuth row that belongs to a person goes with the account, through the
// one deletion path (`deleteUserAccount`, behind both delete routes). A client
// registration belongs to nobody and stays.

const HOUR = 60 * 60 * 1000;

async function makeClient(id: string) {
  return prisma.oAuthClient.create({
    data: { id, clientName: `client ${id}`, redirectUris: ['http://127.0.0.1/callback'], metadata: { client_id: id } },
  });
}

async function connect(user: TestUser, clientId: string) {
  const grant = await prisma.oAuthGrant.create({
    data: { userId: user.id, clientId, scopes: ['dossier:read'], resource: 'http://localhost:3002/mcp' },
  });
  const code = await prisma.oAuthAuthorizationCode.create({
    data: {
      codeHash: `code-${user.id}`,
      clientId,
      userId: user.id,
      grantId: grant.id,
      redirectUri: 'http://127.0.0.1/callback',
      codeChallenge: 'challenge',
      resource: grant.resource,
      scopes: grant.scopes,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  for (const kind of ['ACCESS', 'REFRESH'] as const) {
    await prisma.oAuthToken.create({
      data: {
        tokenHash: `${kind}-${user.id}`,
        kind,
        grantId: grant.id,
        chainId: code.id,
        scopes: grant.scopes,
        resource: grant.resource,
        expiresAt: new Date(Date.now() + HOUR),
      },
    });
  }
  await prisma.oAuthAuthorizationRequest.create({
    data: {
      clientId,
      userId: user.id,
      redirectUri: 'http://127.0.0.1/callback',
      codeChallenge: 'challenge',
      scopes: grant.scopes,
      resource: grant.resource,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
}

async function rowsOf(userId: string) {
  return {
    requests: await prisma.oAuthAuthorizationRequest.count({ where: { userId } }),
    codes: await prisma.oAuthAuthorizationCode.count({ where: { userId } }),
    grants: await prisma.oAuthGrant.count({ where: { userId } }),
    tokens: await prisma.oAuthToken.count({ where: { grant: { userId } } }),
  };
}

describe('what happens to a user’s connected applications when the account goes', () => {
  let alice: TestUser;
  let bob: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('oauth-alice');
    bob = await createTestUser('oauth-bob');
    await makeClient('shared-client');
    await makeClient('unused-client');
    await connect(alice, 'shared-client');
    await connect(bob, 'shared-client');
    // A request nobody has claimed yet belongs to no one and is not touched.
    await prisma.oAuthAuthorizationRequest.create({
      data: {
        clientId: 'unused-client',
        redirectUri: 'http://127.0.0.1/callback',
        codeChallenge: 'challenge',
        scopes: [],
        resource: 'http://localhost:3002/mcp',
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
  });

  async function expectOnlyAlicesRowsGone() {
    expect(await prisma.user.findUnique({ where: { id: alice.id } })).toBeNull();
    expect(await rowsOf(alice.id)).toEqual({ requests: 0, codes: 0, grants: 0, tokens: 0 });
    expect(await rowsOf(bob.id)).toEqual({ requests: 1, codes: 1, grants: 1, tokens: 2 });
    expect(await prisma.oAuthClient.count()).toBe(2);
    expect(await prisma.oAuthAuthorizationRequest.count({ where: { userId: null } })).toBe(1);
  }

  it('removes the grants, tokens, codes and requests when the user deletes the account', async () => {
    const response = await request(app)
      .delete('/api/auth/account')
      .set(authHeader(alice))
      .send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
    expect(response.status).toBe(204);
    await expectOnlyAlicesRowsGone();
  });

  it('does the same when an administrator deletes the user', async () => {
    const admin = await createTestUser('oauth-admin');
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
    const response = await request(app).delete(`/api/admin/users/${alice.id}`).set(authHeader(admin));
    expect(response.status).toBe(204);
    await expectOnlyAlicesRowsGone();
  });
});
