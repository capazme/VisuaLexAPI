import { beforeEach, describe, expect, it } from 'vitest';
import { request, app, createTestUser, authHeader, type TestUser } from '../helpers';
import { connectedTokens, tokenExchange } from './oauthHelpers';

// The consent page promises «il testo delle norme e delle sentenze delle tue pratiche» only with `dossier:text`
// (`SCOPE_LABELS` in src/oauth/consent.ts); `dossier:read` names the norms a dossier holds, not their text. The web
// stores an article's text with its entry (`article_text`), so without `dossier:text` a norm entry reaches a
// connected application as its identity alone. The server is the gate, as for the notes (tests/oauth/notesText).

const IDENTITY = {
  tipo_atto: 'codice civile',
  numero_articolo: '2043',
  data: '1942-03-16',
  numero_atto: '262',
  urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043',
  _dossierMeta: { important: true },
};
const STORED = {
  ...IDENTITY,
  article_text: 'Qualunque fatto doloso o colposo, che cagiona ad altri un danno ingiusto, obbliga colui che ha commesso il fatto a risarcire il danno.',
  brocardi_info: { ratio: 'un commento' },
};

describe('the text of a dossier’s norms, for a connected application', () => {
  let alice: TestUser;
  let dossierId: string;

  beforeEach(async () => {
    alice = await createTestUser('read-scope-alice');
    dossierId = (await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Pratica' })).body.id;
    const added = await request(app).post(`/api/dossiers/${dossierId}/items`).set(authHeader(alice))
      .send({ itemType: 'norm', title: 'Art. 2043', content: STORED });
    expect(added.status).toBe(201);
  });

  async function api(granted: string, scope: string) {
    const tokens = await connectedTokens(alice, granted);
    const exchanged = await tokenExchange(tokens.access, { scope });
    expect(exchanged.status).toBe(200);
    return { Authorization: `Bearer ${exchanged.body.access_token as string}` };
  }

  /** The norm entry, as both dossier routes answer it. */
  async function normEntry(headers: Record<string, string>) {
    const one = await request(app).get(`/api/dossiers/${dossierId}`).set(headers);
    const all = await request(app).get('/api/dossiers').set(headers);
    expect(one.status).toBe(200);
    expect(all.body[0].items).toEqual(one.body.items);
    return one.body.items.find((item: { item_type: string }) => item.item_type === 'norm');
  }

  it('gives the user’s own session the whole entry, as before', async () => {
    expect((await normEntry(authHeader(alice))).content).toEqual(STORED);
  });

  it('gives a connection without dossier:text the norm’s identity and its citation, not its text', async () => {
    const entry = await normEntry(await api('dossier:read dossier:write', 'dossier:read'));
    expect(entry.content).toEqual(IDENTITY);
    expect(entry.citation).toMatch(/2043/);
    expect(entry.title).toBe('Art. 2043');
  });

  it('cuts it too when the grant has dossier:text and the token was exchanged without it', async () => {
    expect((await normEntry(await api('dossier:read dossier:text', 'dossier:read'))).content).toEqual(IDENTITY);
  });

  it('lets nothing through it does not recognise: a content that is not an object, a mark with more than its flag', async () => {
    const add = (content: unknown) => request(app).post(`/api/dossiers/${dossierId}/items`).set(authHeader(alice))
      .send({ itemType: 'norm', title: 'Altra', content });
    await add('Qualunque fatto doloso o colposo…');
    await add({ ...IDENTITY, numero_articolo: '2044', _dossierMeta: { important: true, testo: 'Qualunque fatto doloso…' } });
    const headers = await api('dossier:read dossier:write', 'dossier:read');
    const items = (await request(app).get(`/api/dossiers/${dossierId}`).set(headers)).body.items;
    expect(items[1].content).toBeNull();
    expect(items[2].content).toEqual({ ...IDENTITY, numero_articolo: '2044' });
  });

  it('keeps the identity of an entry in the older Forum shape, and cuts its text the same way', async () => {
    await request(app).post(`/api/dossiers/${dossierId}/items`).set(authHeader(alice)).send({
      itemType: 'norm', title: 'Dal Forum',
      content: { articleRef: { tipo_atto: 'codice civile', numero_articolo: '2045', article_text: 'Quando chi ha commesso…' } },
    });
    const headers = await api('dossier:read dossier:write', 'dossier:read');
    const items = (await request(app).get(`/api/dossiers/${dossierId}`).set(headers)).body.items;
    expect(items[1].content).toEqual({ articleRef: { tipo_atto: 'codice civile', numero_articolo: '2045' } });
  });

  it('gives the whole entry to a token and a grant that both hold dossier:text', async () => {
    expect((await normEntry(await api('dossier:read dossier:text', 'dossier:read dossier:text'))).content).toEqual(STORED);
  });
});
