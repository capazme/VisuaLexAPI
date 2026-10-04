import { beforeEach, describe, expect, it } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from '../helpers';
import { exchangeCode, introspect, startAuthorization, tokenExchange } from './oauthHelpers';

// The separate permission to delete through a connected application (MCP
// second round, spec §4.2): off unless the user ticks it, switchable per
// connection in the settings, and read live from the grant.
const DELETE = 'content:delete';

async function connect(user: TestUser, allowDelete?: boolean, scope = 'dossier:read dossier:write content:delete') {
  const flow = await startAuthorization({ scope });
  const auth = authHeader(user);
  await request(app).get(`/api/oauth/requests/${flow.requestId}`).set(auth);
  const body = allowDelete === undefined ? { approve: true } : { approve: true, allowDelete };
  const decision = await request(app).post(`/api/oauth/requests/${flow.requestId}/decision`).set(auth).send(body);
  if (decision.status !== 200) throw new Error(`decision failed: ${decision.status} ${JSON.stringify(decision.body)}`);
  const code = new URL(decision.body.redirectTo).searchParams.get('code')!;
  const tokens = await exchangeCode(flow.clientId, code, flow.verifier);
  const grant = await prisma.oAuthGrant.findFirstOrThrow({ where: { userId: user.id, clientId: flow.clientId } });
  return { ...flow, access: tokens.body.access_token as string, grant };
}

const scopesOf = async (token: string) => ((await introspect(token)).body.scope as string).split(' ');

describe('the permission to delete', () => {
  let alice: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('delete-alice');
  });

  it('the consent page lists read and write, and the deletion apart', async () => {
    const flow = await startAuthorization({ scope: 'dossier:read dossier:write content:delete' });
    const shown = await request(app).get(`/api/oauth/requests/${flow.requestId}`).set(authHeader(alice));
    expect(shown.status).toBe(200);
    expect(shown.body.scopes.map((s: { scope: string }) => s.scope)).toEqual(['dossier:read', 'dossier:write']);
    expect(shown.body.deletion.label).toMatch(/^Eliminare dossier, voci e schede/);
  });

  it('approving without allowDelete grants no deletion, even if the client asked for it', async () => {
    const { grant, access } = await connect(alice);
    expect(grant.scopes).not.toContain(DELETE);
    expect(await scopesOf(access)).not.toContain(DELETE);
  });

  it('approving with allowDelete grants it, even if the client did not ask', async () => {
    const { grant, access } = await connect(alice, true, 'dossier:read dossier:write');
    expect(grant.scopes).toContain(DELETE);
    expect(await scopesOf(access)).toContain(DELETE);
  });

  it('a new consent decides the deletion again, while read and write still merge', async () => {
    const first = await connect(alice, true);
    const flow = await startAuthorization({ scope: 'dossier:read' });
    // Reuse the same client: the grant is per user and client.
    await prisma.oAuthAuthorizationRequest.update({ where: { id: flow.requestId }, data: { clientId: first.clientId } });
    await request(app).get(`/api/oauth/requests/${flow.requestId}`).set(authHeader(alice));
    const decided = await request(app)
      .post(`/api/oauth/requests/${flow.requestId}/decision`)
      .set(authHeader(alice))
      .send({ approve: true });
    expect(decided.status).toBe(200);
    const grant = await prisma.oAuthGrant.findUniqueOrThrow({ where: { id: first.grant.id } });
    expect(grant.scopes.sort()).toEqual(['dossier:read', 'dossier:write']);
  });

  it('the settings switch it on and off, live: introspection follows without a new token', async () => {
    const { grant, access } = await connect(alice);
    const on = await request(app).patch(`/api/oauth/grants/${grant.id}`).set(authHeader(alice)).send({ canDelete: true });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ id: grant.id, canDelete: true });
    expect(await scopesOf(access)).toContain(DELETE);
    const off = await request(app).patch(`/api/oauth/grants/${grant.id}`).set(authHeader(alice)).send({ canDelete: false });
    expect(off.body.canDelete).toBe(false);
    expect(await scopesOf(access)).not.toContain(DELETE);
    const listed = await request(app).get('/api/oauth/grants').set(authHeader(alice));
    expect(listed.body[0].canDelete).toBe(false);
  });

  it('the exchange grants content:delete only while the grant has it', async () => {
    const { grant, access } = await connect(alice);
    expect((await tokenExchange(access, { scope: DELETE })).body.error).toBe('invalid_scope');
    await prisma.oAuthGrant.update({ where: { id: grant.id }, data: { scopes: { push: DELETE } } });
    const exchanged = await tokenExchange(access, { scope: DELETE });
    expect(exchanged.status).toBe(200);
    expect(exchanged.body.scope).toBe(DELETE);
  });

  it("PATCH on another user's grant or a revoked one is a 404, and the body is strict", async () => {
    const { grant } = await connect(alice);
    const bob = await createTestUser('delete-bob');
    expect((await request(app).patch(`/api/oauth/grants/${grant.id}`).set(authHeader(bob)).send({ canDelete: true })).status).toBe(404);
    expect((await request(app).patch(`/api/oauth/grants/${grant.id}`).set(authHeader(alice)).send({ canDelete: 'yes' })).status).toBe(400);
    expect(
      (await request(app).patch(`/api/oauth/grants/${grant.id}`).set(authHeader(alice)).send({ canDelete: true, scopes: ['x'] })).status,
    ).toBe(400);
    await prisma.oAuthGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    expect((await request(app).patch(`/api/oauth/grants/${grant.id}`).set(authHeader(alice)).send({ canDelete: true })).status).toBe(404);
  });

  it('a connected application cannot switch its own permission', async () => {
    const { grant, access } = await connect(alice);
    const exchanged = await tokenExchange(access, { scope: 'dossier:write' });
    const response = await request(app)
      .patch(`/api/oauth/grants/${grant.id}`)
      .set({ Authorization: `Bearer ${exchanged.body.access_token}` })
      .send({ canDelete: true });
    expect(response.status).toBe(403);
  });
});
