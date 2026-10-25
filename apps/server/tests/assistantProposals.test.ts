import { beforeEach, describe, expect, it } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';
import { delegatedToken } from './oauth/oauthHelpers';

// D7b, first cut: the web app's routes for the assistant's marks and notes, the switch that hides them,
// what the other readers never receive, the light on each entry, and the trash.

const NORM = { tipo_atto: 'codice civile', numero_articolo: '1453', data: '1942-03-16', numero_atto: '262' };
const KEY = 'codice-civile--262--1942-03-16--1453::art::1453';

async function switchOn(enabled = true) {
  await prisma.appSwitch.upsert({ where: { key: 'assistant_passages' }, create: { key: 'assistant_passages', enabled }, update: { enabled } });
}

/** An assistant's mark as the delegated route stores it (the route is tested on its own). */
function proposal(userId: string, itemId: string, over: Partial<{ id: string; note: string | null; startOffset: number; text: string }> = {}) {
  const text = over.text ?? 'la risoluzione del contratto';
  const startOffset = over.startOffset ?? 40;
  const note = over.note === undefined ? 'Rilevante per il ritardo.' : over.note;
  return prisma.highlight.create({
    data: {
      ...(over.id ? { id: over.id } : {}),
      userId,
      normaKey: KEY,
      text,
      color: 'yellow',
      startOffset,
      endOffset: startOffset + text.length,
      note,
      createdByClientId: 'client-1',
      createdByClientName: 'Claude Code',
      dossierItemId: itemId,
      assistantText: text,
      assistantStartOffset: startOffset,
      assistantNote: note,
      noteState: note === null ? null : 'proposed',
    },
  });
}

describe('D7b — the assistant’s proposals, for the web app', () => {
  let alice: TestUser;
  let bob: TestUser;
  let dossierId: string;
  let itemId: string;
  const base = () => `/api/dossiers/${dossierId}/items/${itemId}`;

  beforeEach(async () => {
    alice = await createTestUser('d7b-alice');
    bob = await createTestUser('d7b-bob');
    dossierId = (await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Pratica' })).body.id;
    itemId = (await request(app).post(`/api/dossiers/${dossierId}/items`).set(authHeader(alice)).send({ itemType: 'norm', title: 'Art. 1453', content: NORM })).body.id;
  });

  describe('the switch', () => {
    it('is off by default: GET /features says so and every route answers 404', async () => {
      const features = await request(app).get('/api/features').set(authHeader(alice));
      expect(features.status).toBe(200);
      expect(features.body).toEqual({ assistantPassages: false });
      // Public: the MCP server asks it with no token before a session lists its tools.
      expect((await request(app).get('/api/features')).body).toEqual({ assistantPassages: false });
      const p = await proposal(alice.id, itemId);
      for (const call of [
        request(app).get(`${base()}/proposals`),
        request(app).put(`${base()}/proposals/${p.id}/state`).send({ state: 'validated' }),
        request(app).put(`${base()}/proposals/${p.id}/note`).send({ text: 'x' }),
        request(app).put(`${base()}/proposals/${p.id}/range`).send({ startOffset: 1, text: 'abc' }),
        request(app).delete(`${base()}/proposals/${p.id}`),
        request(app).put(`${base()}/state`).send({ state: 'validated' }),
        request(app).put(`${base()}/text`).send({ text: 'x' }),
      ]) {
        const response = await call.set(authHeader(alice));
        expect(response.status).toBe(404);
        expect(response.body.detail).toBe('Non disponibile');
      }
      expect(await prisma.highlight.count()).toBe(1);
    });

    it('is switched by an admin only', async () => {
      expect((await request(app).put('/api/admin/switches/assistant_passages').set(authHeader(alice)).send({ enabled: true })).status).toBe(403);
      await prisma.user.update({ where: { id: alice.id }, data: { isAdmin: true } });
      const on = await request(app).put('/api/admin/switches/assistant_passages').set(authHeader(alice)).send({ enabled: true });
      expect(on.status).toBe(200);
      expect(on.body).toMatchObject({ key: 'assistant_passages', enabled: true });
      expect((await request(app).get('/api/features').set(authHeader(bob))).body).toEqual({ assistantPassages: true });
      const list = await request(app).get('/api/admin/switches').set(authHeader(alice));
      expect(list.body.switches).toEqual([expect.objectContaining({ key: 'assistant_passages', enabled: true })]);
      expect((await request(app).put('/api/admin/switches/nope').set(authHeader(alice)).send({ enabled: true })).status).toBe(404);
      expect((await request(app).put('/api/admin/switches/assistant_passages').set(authHeader(alice)).send({ enabled: 'yes' })).status).toBe(400);
    });
  });

  describe('with the switch on', () => {
    beforeEach(() => switchOn());

    it('lists the entry’s proposals in the agreed shape, in text order', async () => {
      await proposal(alice.id, itemId, { startOffset: 90, text: 'il risarcimento del danno' });
      await proposal(alice.id, itemId, { note: null });
      const response = await request(app).get(`${base()}/proposals`).set(authHeader(alice));
      expect(response.status).toBe(200);
      expect(response.body.proposals).toHaveLength(2);
      const [first, second] = response.body.proposals;
      expect(first).toMatchObject({
        normaKey: KEY,
        text: 'la risoluzione del contratto',
        color: 'yellow',
        startOffset: 40,
        endOffset: 40 + 'la risoluzione del contratto'.length,
        dossierItemId: itemId,
        proposedBy: { clientName: 'Claude Code' },
        assistantRange: { startOffset: 40, text: 'la risoluzione del contratto' },
        rangeEdited: false,
        rangeEditedAt: null,
        rangeEditedBy: null,
        note: null,
      });
      expect(second.startOffset).toBe(90);
      expect(second.note).toEqual({
        text: 'Rilevante per il ritardo.',
        assistantText: 'Rilevante per il ritardo.',
        state: 'proposed',
        stateChangedAt: null,
        reviewComment: null,
        edited: false,
        editedAt: null,
        editedBy: null,
      });
    });

    it('never answers another user’s dossier, entry or proposal', async () => {
      const p = await proposal(alice.id, itemId);
      const other = (await request(app).post('/api/dossiers').set(authHeader(bob)).send({ name: 'Altro' })).body.id;
      const bobItem = (await request(app).post(`/api/dossiers/${other}/items`).set(authHeader(bob)).send({ itemType: 'norm', title: 'x', content: NORM })).body.id;
      expect((await request(app).get(`${base()}/proposals`).set(authHeader(bob))).body.detail).toBe('Dossier non trovato');
      expect((await request(app).put(`${base()}/proposals/${p.id}/state`).set(authHeader(bob)).send({ state: 'validated' })).status).toBe(404);
      expect((await request(app).delete(`${base()}/proposals/${p.id}`).set(authHeader(bob))).status).toBe(404);
      // Bob's own entry, Alice's proposal id: not his.
      const cross = await request(app).put(`/api/dossiers/${other}/items/${bobItem}/proposals/${p.id}/state`).set(authHeader(bob)).send({ state: 'validated' });
      expect(cross.status).toBe(404);
      expect(cross.body.detail).toBe('Proposta non trovata');
      // An entry of another dossier of hers.
      const second = (await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Seconda' })).body.id;
      expect((await request(app).get(`/api/dossiers/${second}/items/${itemId}/proposals`).set(authHeader(alice))).body.detail).toBe('Voce non trovata');
      expect((await prisma.highlight.findUniqueOrThrow({ where: { id: p.id } })).noteState).toBe('proposed');
    });

    it('is not reachable by an exchanged token', async () => {
      const { apiToken } = await delegatedToken(alice, 'dossier:read dossier:write');
      const p = await proposal(alice.id, itemId);
      const delegatedCall = { Authorization: `Bearer ${apiToken}` };
      expect((await request(app).get(`${base()}/proposals`).set(delegatedCall)).status).toBe(403);
      expect((await request(app).put(`${base()}/proposals/${p.id}/state`).set(delegatedCall).send({ state: 'validated' })).status).toBe(403);
      expect((await request(app).delete(`${base()}/proposals/${p.id}`).set(delegatedCall)).status).toBe(403);
    });

    it('moves a note through its three states, keeping the review comment', async () => {
      const p = await proposal(alice.id, itemId);
      const state = (body: object) => request(app).put(`${base()}/proposals/${p.id}/state`).set(authHeader(alice)).send(body);

      const green = await state({ state: 'validated' });
      expect(green.status).toBe(200);
      expect(green.body.note).toMatchObject({ state: 'validated', edited: false, reviewComment: null });
      const changedAt = green.body.note.stateChangedAt;
      expect(changedAt).toEqual(expect.any(String));
      // The same state again changes nothing.
      expect((await state({ state: 'validated' })).body.note.stateChangedAt).toBe(changedAt);

      const red = await state({ state: 'review', comment: '  Il termine è sbagliato.  ' });
      expect(red.body.note).toMatchObject({ state: 'review', reviewComment: 'Il termine è sbagliato.' });
      // A review with no comment keeps the last one.
      expect((await state({ state: 'review' })).body.note.reviewComment).toBe('Il termine è sbagliato.');
      // Leaving review hides it from the answer, but the server keeps it for the second cut.
      const yellow = await state({ state: 'proposed', comment: 'ignorato fuori da review' });
      expect(yellow.body.note).toMatchObject({ state: 'proposed', reviewComment: null });
      expect((await prisma.highlight.findUniqueOrThrow({ where: { id: p.id } })).reviewComment).toBe('Il termine è sbagliato.');

      expect((await state({ state: 'review', comment: 'a'.repeat(501) })).status).toBe(400);
      expect((await state({ state: 'review', comment: 'a\u0007b' })).status).toBe(400);
      expect((await state({ state: 'done' })).status).toBe(400);
      expect((await state({ state: 'validated', extra: 1 })).status).toBe(400);
    });

    it('refuses a state or an edit on a mark with no note', async () => {
      const p = await proposal(alice.id, itemId, { note: null });
      expect((await request(app).put(`${base()}/proposals/${p.id}/state`).set(authHeader(alice)).send({ state: 'validated' })).status).toBe(409);
      expect((await request(app).put(`${base()}/proposals/${p.id}/note`).set(authHeader(alice)).send({ text: 'mia' })).status).toBe(409);
    });

    it('edits the note: validated «modificato da te», the original kept through every edit', async () => {
      const p = await proposal(alice.id, itemId);
      const edit = (text: string) => request(app).put(`${base()}/proposals/${p.id}/note`).set(authHeader(alice)).send({ text });
      await request(app).put(`${base()}/proposals/${p.id}/state`).set(authHeader(alice)).send({ state: 'review', comment: 'Troppo generica.' });

      const first = await edit('  Rilevante: termine essenziale.  ');
      expect(first.status).toBe(200);
      expect(first.body.note).toMatchObject({
        text: 'Rilevante: termine essenziale.',
        assistantText: 'Rilevante per il ritardo.',
        state: 'validated',
        edited: true,
        editedBy: { username: 'd7b-alice' },
      });
      const second = await edit('Seconda versione.');
      expect(second.body.note.assistantText).toBe('Rilevante per il ritardo.');
      expect(second.body.note.text).toBe('Seconda versione.');
      // The same text changes nothing, not even the stamp.
      const same = await edit('Seconda versione.');
      expect(same.body.note.editedAt).toBe(second.body.note.editedAt);
      // Emptied: still the assistant's note, edited.
      expect((await edit('   ')).body.note).toMatchObject({ text: '', edited: true, state: 'validated', assistantText: 'Rilevante per il ritardo.' });
      expect((await edit('a'.repeat(4001))).status).toBe(400);
      const row = await prisma.highlight.findUniqueOrThrow({ where: { id: p.id } });
      expect(row.assistantNote).toBe('Rilevante per il ritardo.');
    });

    it('moves the boundaries, keeping the assistant’s and leaving the note’s state alone', async () => {
      const p = await proposal(alice.id, itemId);
      const moved = await request(app).put(`${base()}/proposals/${p.id}/range`).set(authHeader(alice)).send({ startOffset: 43, text: 'risoluzione' });
      expect(moved.status).toBe(200);
      expect(moved.body).toMatchObject({
        startOffset: 43,
        endOffset: 43 + 'risoluzione'.length,
        text: 'risoluzione',
        assistantRange: { startOffset: 40, text: 'la risoluzione del contratto' },
        rangeEdited: true,
        rangeEditedBy: { username: 'd7b-alice' },
      });
      expect(moved.body.note.state).toBe('proposed');
      const again = await request(app).put(`${base()}/proposals/${p.id}/range`).set(authHeader(alice)).send({ startOffset: 43, text: 'risoluzione' });
      expect(again.body.rangeEditedAt).toBe(moved.body.rangeEditedAt);
      expect((await request(app).put(`${base()}/proposals/${p.id}/range`).set(authHeader(alice)).send({ startOffset: -1, text: 'x' })).status).toBe(400);
      expect((await request(app).put(`${base()}/proposals/${p.id}/range`).set(authHeader(alice)).send({ startOffset: 1, text: '' })).status).toBe(400);
    });

    it('removes a proposal for good', async () => {
      const p = await proposal(alice.id, itemId);
      expect((await request(app).delete(`${base()}/proposals/${p.id}`).set(authHeader(alice))).status).toBe(204);
      expect(await prisma.highlight.count({ where: { id: p.id } })).toBe(0);
      expect((await request(app).delete(`${base()}/proposals/${p.id}`).set(authHeader(alice))).status).toBe(404);
    });
  });

  describe('what the other readers never receive', () => {
    it('leaves the assistant’s marks out of GET /highlights in every state, and out of the generic routes', async () => {
      await switchOn();
      const mine = await request(app).post('/api/highlights').set(authHeader(alice)).send({ normaKey: KEY, text: 'contratto', color: 'green', startOffset: 60, endOffset: 69 });
      const p = await proposal(alice.id, itemId);
      const bare = await proposal(alice.id, itemId, { note: null, startOffset: 100 });
      await request(app).put(`${base()}/proposals/${p.id}/state`).set(authHeader(alice)).send({ state: 'validated' });
      for (const query of [{ normaKey: KEY }, { normaKeyPrefix: 'codice-civile--262--1942-03-16--1453::art::' }]) {
        const list = await request(app).get('/api/highlights').query(query).set(authHeader(alice));
        expect(list.body.map((h: { id: string }) => h.id)).toEqual([mine.body.id]);
      }
      expect((await request(app).put(`/api/highlights/${p.id}`).set(authHeader(alice)).send({ note: 'altro' })).status).toBe(404);
      expect((await request(app).delete(`/api/highlights/${bare.id}`).set(authHeader(alice))).status).toBe(404);
      expect(await prisma.highlight.count()).toBe(3);
    });
  });

  describe('a study import beside an assistant’s mark', () => {
    it('adds the user’s highlight on the same words: the assistant’s mark is not one of the user’s', async () => {
      const p = await proposal(alice.id, itemId);
      const imported = await request(app).post('/api/dossiers/import-study').set(authHeader(alice)).send({
        content: {
          dossiers: [{ title: 'Studio', items: [{ type: 'norma', data: NORM }] }],
          quickNorms: [],
          annotations: [],
          highlights: [{ normaKey: KEY.split('::art::')[0], articleId: '1453', text: p.text, color: 'yellow', startOffset: p.startOffset }],
        },
      });
      expect(imported.status).toBe(201);
      expect(await prisma.highlight.count({ where: { userId: alice.id, normaKey: KEY, createdByClientId: null } })).toBe(1);
    });
  });

  describe('the assistant’s note entries and the light on each entry', () => {
    let noteId: string;
    beforeEach(async () => {
      await switchOn();
      const { apiToken } = await delegatedToken(alice);
      const created = await request(app)
        .post(`/api/dossiers/${dossierId}/notes`)
        .set({ Authorization: `Bearer ${apiToken}` })
        .send({ text: 'Sul termine essenziale.', aboutItemId: itemId });
      expect(created.status).toBe(201);
      // An application never reads a state in this cut.
      expect(created.body.assistant_note).toBeNull();
      noteId = created.body.id;
    });

    it('starts the assistant’s note entry as proposed and shows its state to the session', async () => {
      const read = await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice));
      const note = read.body.items.find((i: { id: string }) => i.id === noteId);
      expect(note.assistant_note).toEqual({
        state: 'proposed',
        state_changed_at: null,
        review_comment: null,
        original_text: 'Sul termine essenziale.',
        edited: false,
        edited_at: null,
        edited_by: null,
      });
      expect(note.assistant_notes).toBeNull();
      // The user's own note has none.
      const own = await request(app).post(`/api/dossiers/${dossierId}/notes`).set(authHeader(alice)).send({ text: 'Mia.' });
      expect(own.body.assistant_note).toBeNull();
      expect((await request(app).put(`/api/dossiers/${dossierId}/items/${own.body.id}/state`).set(authHeader(alice)).send({ state: 'validated' })).status).toBe(409);
    });

    it('counts the notes of the entry’s passages and the assistant’s notes about it, never a bare mark', async () => {
      await proposal(alice.id, itemId);
      const red = await proposal(alice.id, itemId, { startOffset: 100 });
      await proposal(alice.id, itemId, { note: null, startOffset: 150 });
      await request(app).put(`${base()}/proposals/${red.id}/state`).set(authHeader(alice)).send({ state: 'review' });
      const read = await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice));
      const norm = read.body.items.find((i: { id: string }) => i.id === itemId);
      expect(norm.assistant_notes).toEqual({ proposed: 2, validated: 0, review: 1 });
      expect(norm.assistant_note).toBeNull();
      // The list of dossiers carries the same.
      const list = await request(app).get('/api/dossiers').set(authHeader(alice));
      expect(list.body[0].items.find((i: { id: string }) => i.id === itemId).assistant_notes).toEqual({ proposed: 2, validated: 0, review: 1 });
      // An exchanged token reads none of it.
      const { apiToken } = await delegatedToken(alice, 'dossier:read');
      const delegatedRead = await request(app).get(`/api/dossiers/${dossierId}`).set({ Authorization: `Bearer ${apiToken}` });
      expect(delegatedRead.body.items.every((i: { assistant_notes: unknown; assistant_note: unknown }) => i.assistant_notes === null && i.assistant_note === null)).toBe(true);
      // Nor the session, with the switch off.
      await switchOn(false);
      const off = await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice));
      expect(off.body.items.every((i: { assistant_notes: unknown; assistant_note: unknown }) => i.assistant_notes === null && i.assistant_note === null)).toBe(true);
    });

    it('gives null to an entry the assistant wrote nothing on', async () => {
      const read = await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice));
      const other = (await request(app).post(`/api/dossiers/${dossierId}/items`).set(authHeader(alice)).send({ itemType: 'norm', title: 'x', content: { ...NORM, numero_articolo: '2043' } })).body;
      expect(other.assistant_notes).toBeNull();
      expect(read.body.items.find((i: { id: string }) => i.id === itemId).assistant_notes).toEqual({ proposed: 1, validated: 0, review: 0 });
    });

    it('validates, flags and edits the note entry, keeping the original', async () => {
      const at = `/api/dossiers/${dossierId}/items/${noteId}`;
      const red = await request(app).put(`${at}/state`).set(authHeader(alice)).send({ state: 'review', comment: 'Manca la fonte.' });
      expect(red.status).toBe(200);
      expect(red.body.assistant_note).toMatchObject({ state: 'review', review_comment: 'Manca la fonte.' });
      const edited = await request(app).put(`${at}/text`).set(authHeader(alice)).send({ text: 'Sul termine essenziale (art. 1457 c.c.).' });
      expect(edited.body.content).toBe('Sul termine essenziale (art. 1457 c.c.).');
      expect(edited.body.assistant_note).toMatchObject({ state: 'validated', edited: true, original_text: 'Sul termine essenziale.', edited_by: { username: 'd7b-alice' } });
      expect((await request(app).put(`${at}/text`).set(authHeader(alice)).send({ text: '  ' })).status).toBe(400);
      // The generic update keeps the original and stamps the edit too.
      const generic = await request(app).put(at).set(authHeader(alice)).send({ content: 'Terza versione.' });
      expect(generic.body.assistant_note).toMatchObject({ edited: true, original_text: 'Sul termine essenziale.' });
      expect((await request(app).put(at).set(authHeader(alice)).send({ content: { note: 'oggetto' } })).status).toBe(400);
      // The light of the article follows.
      const read = await request(app).get(`/api/dossiers/${dossierId}`).set(authHeader(alice));
      expect(read.body.items.find((i: { id: string }) => i.id === itemId).assistant_notes).toEqual({ proposed: 0, validated: 1, review: 0 });
    });
  });

  describe('the trash', () => {
    beforeEach(() => switchOn());

    it('takes the entry’s marks with it and brings them back with their state', async () => {
      const p = await proposal(alice.id, itemId);
      const bare = await proposal(alice.id, itemId, { note: null, startOffset: 100 });
      await request(app).put(`${base()}/proposals/${p.id}/state`).set(authHeader(alice)).send({ state: 'review', comment: 'Da rivedere.' });
      await request(app).put(`${base()}/proposals/${p.id}/note`).set(authHeader(alice)).send({ text: 'Mia versione.' });
      const before = await prisma.highlight.findUniqueOrThrow({ where: { id: p.id } });

      const trashed = await request(app).delete(`/api/dossiers/${dossierId}/items/${itemId}`).set(authHeader(alice));
      expect(trashed.status).toBe(200);
      expect(await prisma.highlight.count()).toBe(0);
      const restored = await request(app).post(`/api/trash/${trashed.body.trashId}/restore`).set(authHeader(alice)).send({});
      expect(restored.status).toBe(200);
      const after = await prisma.highlight.findUniqueOrThrow({ where: { id: p.id } });
      expect(after).toEqual(before);
      expect(await prisma.highlight.count({ where: { id: bare.id } })).toBe(1);
    });

    it('does the same for a whole dossier', async () => {
      const p = await proposal(alice.id, itemId);
      const before = await prisma.highlight.findUniqueOrThrow({ where: { id: p.id } });
      const trashed = await request(app).delete(`/api/dossiers/${dossierId}`).set(authHeader(alice));
      expect(trashed.status).toBe(200);
      expect(await prisma.highlight.count()).toBe(0);
      expect((await request(app).post(`/api/trash/${trashed.body.trashId}/restore`).set(authHeader(alice)).send({})).status).toBe(200);
      expect(await prisma.highlight.findUniqueOrThrow({ where: { id: p.id } })).toEqual(before);
      const listed = await request(app).get(`${base()}/proposals`).set(authHeader(alice));
      expect(listed.body.proposals.map((x: { id: string }) => x.id)).toEqual([p.id]);
    });

    it('keeps the user’s own highlights where they are, and an assistant’s note entry’s state', async () => {
      const mine = await request(app).post('/api/highlights').set(authHeader(alice)).send({ normaKey: KEY, text: 'contratto', color: 'green', startOffset: 60, endOffset: 69 });
      const { apiToken } = await delegatedToken(alice);
      const note = await request(app).post(`/api/dossiers/${dossierId}/notes`).set({ Authorization: `Bearer ${apiToken}` }).send({ text: 'Nota IA.' });
      await request(app).put(`/api/dossiers/${dossierId}/items/${note.body.id}/state`).set(authHeader(alice)).send({ state: 'review', comment: 'No.' });
      const trashed = await request(app).post(`/api/dossiers/${dossierId}/trash-items`).set(authHeader(alice)).send({ itemIds: [itemId, note.body.id] });
      expect(trashed.status).toBe(200);
      expect(await prisma.highlight.count({ where: { id: mine.body.id } })).toBe(1);
      await request(app).post(`/api/trash/${trashed.body.trashId}/restore`).set(authHeader(alice)).send({});
      const back = await prisma.dossierItem.findUniqueOrThrow({ where: { id: note.body.id } });
      expect(back).toMatchObject({ noteState: 'review', reviewComment: 'No.', assistantNote: 'Nota IA.' });
    });

    it('restores an entry trashed before D7b, which carries no proposals', async () => {
      const trashed = await request(app).delete(`/api/dossiers/${dossierId}/items/${itemId}`).set(authHeader(alice));
      const entry = await prisma.trashEntry.findUniqueOrThrow({ where: { id: trashed.body.trashId } });
      const { items } = entry.payload as { items: Record<string, unknown>[] };
      const old = items.map(({ assistantNote: _a, noteState: _s, noteStateChangedAt: _c, reviewComment: _r, noteEditedAt: _e, noteEditedBy: _b, ...rest }) => rest);
      await prisma.trashEntry.update({ where: { id: entry.id }, data: { payload: { items: old } as object } });
      expect((await request(app).post(`/api/trash/${entry.id}/restore`).set(authHeader(alice)).send({})).status).toBe(200);
      expect(await prisma.dossierItem.count({ where: { id: itemId } })).toBe(1);
    });
  });
});
