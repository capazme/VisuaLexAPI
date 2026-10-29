import { beforeEach, describe, expect, it } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from '../helpers';
import { authorizeQuery, connectedTokens, pkcePair, tokenExchange } from './oauthHelpers';
import { TEXT_CONSENT_VERSION } from '../../src/oauth/config';

// G-381 (b): the text of the user's notes reaches a connected application only through a token with `dossier:text`
// whose grant was approved with the words that name the notes («… e le tue note»). A grant approved before keeps
// today's behaviour (no note's text) until the user connects again. The server is the gate; the MCP filters too.

const NORM = { tipo_atto: 'codice civile', numero_articolo: '2043', data: '1942-03-16', numero_atto: '262' };

describe('the text of the user’s notes, for a connected application', () => {
  let alice: TestUser;
  let dossierId: string;

  beforeEach(async () => {
    alice = await createTestUser('notes-text-alice');
    dossierId = (await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Pratica' })).body.id;
    const add = (body: object) => request(app).post(`/api/dossiers/${dossierId}/items`).set(authHeader(alice)).send(body);
    await add({ itemType: 'norm', title: 'Art. 2043', content: NORM });
    await add({ itemType: 'note', title: 'Nota', content: 'Il cliente ha ricevuto la diffida il 3 marzo.' });
  });

  /** A connection granted `granted`, and an API token exchanged for `scope`. */
  async function connection(granted: string, scope: string) {
    const tokens = await connectedTokens(alice, granted);
    const exchanged = await tokenExchange(tokens.access, { scope });
    expect(exchanged.status).toBe(200);
    return { ...tokens, api: { Authorization: `Bearer ${exchanged.body.access_token as string}` } };
  }

  /** What the application reads of the dossier: its entries' content, by kind, from both routes. */
  async function contents(headers: Record<string, string>) {
    const one = await request(app).get(`/api/dossiers/${dossierId}`).set(headers);
    const all = await request(app).get('/api/dossiers').set(headers);
    expect(one.status).toBe(200);
    expect(all.body[0].items).toEqual(one.body.items);
    return Object.fromEntries(one.body.items.map((i: { item_type: string; content: unknown }) => [i.item_type, i.content]));
  }

  it('gives the user’s own session every content, as before', async () => {
    expect(await contents(authHeader(alice))).toEqual({ norm: NORM, note: 'Il cliente ha ricevuto la diffida il 3 marzo.' });
  });

  it('leaves a note’s content out without dossier:text, in the grant or in the token, and never a norm’s', async () => {
    expect(await contents((await connection('dossier:read dossier:write', 'dossier:read')).api)).toEqual({ norm: NORM, note: null });
    // The grant has it, the token was exchanged without it.
    expect(await contents((await connection('dossier:read dossier:text', 'dossier:read')).api)).toEqual({ norm: NORM, note: null });
  });

  it('gives it with dossier:text to a grant approved with the words naming the notes', async () => {
    const { api } = await connection('dossier:read dossier:text', 'dossier:read dossier:text');
    const grant = await prisma.oAuthGrant.findFirstOrThrow({ where: { userId: alice.id } });
    expect(grant.textConsentVersion).toBe(TEXT_CONSENT_VERSION);
    expect(await contents(api)).toEqual({ norm: NORM, note: 'Il cliente ha ricevuto la diffida il 3 marzo.' });
  });

  it('records no version for a grant approved without the texts', async () => {
    await connection('dossier:read dossier:write', 'dossier:read');
    expect((await prisma.oAuthGrant.findFirstOrThrow({ where: { userId: alice.id } })).textConsentVersion).toBeNull();
  });

  it('keeps a grant approved before the words out of the notes, until the user connects again', async () => {
    const { api, clientId } = await connection('dossier:read dossier:text', 'dossier:read dossier:text');
    // As every grant the migration found: dossier:text, no version.
    await prisma.oAuthGrant.updateMany({ where: { userId: alice.id }, data: { textConsentVersion: null } });
    expect(await contents(api)).toEqual({ norm: NORM, note: null });

    // The user connects the same application again and approves the texts on today's consent page.
    const { challenge } = pkcePair();
    const authorize = await request(app).get('/oauth/authorize').query(authorizeQuery(clientId, { code_challenge: challenge, scope: 'dossier:read dossier:text' }));
    const requestId = new URL(authorize.headers.location).searchParams.get('request')!;
    await request(app).get(`/api/oauth/requests/${requestId}`).set(authHeader(alice));
    expect((await request(app).post(`/api/oauth/requests/${requestId}/decision`).set(authHeader(alice)).send({ approve: true })).status).toBe(200);
    const grants = await prisma.oAuthGrant.findMany({ where: { userId: alice.id } });
    expect(grants).toHaveLength(1);
    expect(grants[0].textConsentVersion).toBe(TEXT_CONSENT_VERSION);
    // The token of the same grant now reads the notes: the consent is read live from the grant.
    expect(await contents(api)).toEqual({ norm: NORM, note: 'Il cliente ha ricevuto la diffida il 3 marzo.' });
  });
});
