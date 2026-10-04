import { beforeEach, describe, expect, it } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';
import { delegatedToken } from './oauth/oauthHelpers';
import { spendDelegatedCounter } from '../src/middleware/delegated';

// POST /api/dossiers/:id/notes (MCP second round, spec §5): a note in a
// dossier, or about one of its articles as a whole. Open to the user's session
// (the web app) and to an exchanged token with dossier:write.
describe('POST /api/dossiers/:id/notes', () => {
  let alice: TestUser;
  let dossierId: string;
  let normId: string;
  const note = (who: Record<string, string>, body: unknown, id = dossierId) =>
    request(app).post(`/api/dossiers/${id}/notes`).set(who).send(body as object);

  beforeEach(async () => {
    alice = await createTestUser('notes-alice');
    dossierId = (await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Prova' })).body.id;
    normId = (
      await request(app)
        .post(`/api/dossiers/${dossierId}/items`)
        .set(authHeader(alice))
        .send({ itemType: 'norm', title: 'codice civile', content: { tipo_atto: 'codice civile', numero_articolo: '2043', data: '1942-03-16', numero_atto: '262', urn: 'urn:x~art2043' } })
    ).body.id;
  });

  it('adds a note with the user session, unmarked, after the last entry', async () => {
    const response = await note(authHeader(alice), { text: '  Vedi anche la giurisprudenza.  ' });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      item_type: 'note',
      title: 'Nota',
      content: 'Vedi anche la giurisprudenza.',
      position: 1,
      created_by: null,
      about_item_id: null,
    });
  });

  it('adds a note through an exchanged token, marked with the connection', async () => {
    const { apiToken } = await delegatedToken(alice);
    const response = await note({ Authorization: `Bearer ${apiToken}` }, { text: 'Scritta da Claude.' });
    expect(response.status).toBe(201);
    expect(response.body.created_by).toEqual({ clientName: 'Claude Code' });
  });

  it('keeps new lines and refuses empty text, more than 4000 characters, and control characters', async () => {
    expect((await note(authHeader(alice), { text: 'riga 1\nriga 2' })).status).toBe(201);
    expect((await note(authHeader(alice), { text: '   ' })).status).toBe(400);
    expect((await note(authHeader(alice), { text: 'a'.repeat(4001) })).status).toBe(400);
    expect((await note(authHeader(alice), { text: 'a'.repeat(4000) })).status).toBe(201);
    expect((await note(authHeader(alice), { text: 'a\u0007b' })).status).toBe(400);
    expect((await note(authHeader(alice), { text: 'ok', extra: 1 })).status).toBe(400);
  });

  it('attaches a note to an article of the same dossier', async () => {
    const response = await note(authHeader(alice), { text: 'Sul danno.', aboutItemId: normId });
    expect(response.status).toBe(201);
    expect(response.body.about_item_id).toBe(normId);
    const read = await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice));
    expect(read.body.items[1].about_item_id).toBe(normId);
  });

  it('refuses to attach a note to another dossier\'s article, to a note, or to an unknown id', async () => {
    const other = (await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Altro' })).body.id;
    const otherNorm = (
      await request(app).post(`/api/dossiers/${other}/items`).set(authHeader(alice)).send({ itemType: 'norm', title: 'x', content: {} })
    ).body.id;
    const aNote = (await note(authHeader(alice), { text: 'nota' })).body.id;
    for (const aboutItemId of [otherNorm, aNote, '00000000-0000-4000-8000-000000000000']) {
      const response = await note(authHeader(alice), { text: 'Sul danno.', aboutItemId });
      expect(response.status).toBe(400);
      expect(response.body.detail).toBe('La voce indicata non è un articolo di questo dossier.');
    }
    expect(await prisma.dossierItem.count({ where: { dossierId, itemType: 'note' } })).toBe(1);
  });

  it("answers 404 for another user's dossier", async () => {
    const bob = await createTestUser('notes-bob');
    expect((await note(authHeader(bob), { text: 'intrusa' })).status).toBe(404);
  });

  it('refuses the 101st note of the day through an exchanged token, never the user session', async () => {
    const { apiToken } = await delegatedToken(alice);
    await spendDelegatedCounter(alice.id, 'note', 100);
    const refused = await note({ Authorization: `Bearer ${apiToken}` }, { text: 'una di troppo' });
    expect(refused.status).toBe(429);
    expect(refused.body.quota).toBe('note');
    expect(refused.body.detail).toBe('Limite giornaliero di note scritte tramite applicazioni collegate raggiunto.');
    expect((await note(authHeader(alice), { text: 'mia' })).status).toBe(201);
  });

  it('costs two points through an exchanged token', async () => {
    const { apiToken } = await delegatedToken(alice);
    const bearer = { Authorization: `Bearer ${apiToken}` };
    const before = (await request(app).get('/api/oauth/quota').set(bearer)).body;
    await note(bearer, { text: 'costa due punti' });
    const after = (await request(app).get('/api/oauth/quota').set(bearer)).body;
    expect(before.points.remaining - after.points.remaining).toBe(2);
    expect(before.counters.note.remaining - after.counters.note.remaining).toBe(1);
  });
});
