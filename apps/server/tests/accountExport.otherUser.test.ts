import { describe, expect, it } from 'vitest';
import { request, app, createTestUser, authHeader, prisma, type TestUser } from './helpers';

// G-306: the account export holds what the user wrote or what is about them, never another
// person's id, name, email or text. One second user touches the first user's world everywhere
// they can, and the whole serialized export is searched for them, not selected fields.
//
// What Bob still owns is written with BOB_SAYS; what Alice took from him (a suggestion she
// accepted, a Forum download) is hers now and carries neutral text, so only his identity is
// searched there.
const BOB_SAYS = 'BOB-SAYS';

async function seedBobEverywhere(alice: TestUser, bob: TestUser) {
  const said = (what: string) => `${BOB_SAYS} ${what}`;

  // Discussions: Alice's glossa, Bob's replies (one under hers), votes, a report, a release by Bob.
  const thread = await prisma.articleThread.create({
    data: {
      normaKey: 'codice_civile', articleId: '1453', title: 'La glossa di Alice', body: 'Testo di Alice', userId: alice.id,
      passageQuote: 'Nei contratti con prestazioni corrispettive', passageStart: 0, passagePrefix: '', passageSuffix: '',
      passageReleasedAt: new Date(), passageReleasedById: bob.id,
    },
  });
  const aliceComment = await prisma.articleComment.create({ data: { threadId: thread.id, body: 'Risposta di Alice', userId: alice.id } });
  const bobComment = await prisma.articleComment.create({ data: { threadId: thread.id, body: said('risposta alla glossa'), userId: bob.id } });
  await prisma.articleComment.create({ data: { threadId: thread.id, parentId: aliceComment.id, body: said('risposta ad Alice'), userId: bob.id } });
  await prisma.articleComment.create({ data: { threadId: thread.id, parentId: bobComment.id, body: 'Alice risponde a una risposta', userId: alice.id } });
  await prisma.articleThreadVote.create({ data: { threadId: thread.id, userId: bob.id } });
  await prisma.articleCommentVote.create({ data: { commentId: aliceComment.id, userId: bob.id } });
  await prisma.articleThreadReport.create({ data: { threadId: thread.id, userId: bob.id, reason: 'altro', details: said('segnalazione') } });
  // Bob's own glossa, with Alice's reply under it: her reply is hers, the glossa is not.
  const bobThread = await prisma.articleThread.create({
    data: { normaKey: 'codice_civile', articleId: '2043', title: said('glossa'), body: said('testo della glossa'), userId: bob.id },
  });
  await prisma.articleComment.create({ data: { threadId: bobThread.id, body: 'Alice sotto la glossa di Bob', userId: alice.id } });

  // The Forum: Alice publishes, Bob likes, reports and proposes; Alice takes some, declines one, leaves one.
  const published = await request(app).post('/api/shared-environments').set(authHeader(alice))
    .send({ title: 'Ambiente di Alice', category: 'civil', content: { dossiers: [], quickNorms: [], annotations: [], highlights: [] } });
  expect(published.status).toBe(201);
  const envId = published.body.id as string;
  expect((await request(app).post(`/api/shared-environments/${envId}/like`).set(authHeader(bob))).status).toBeLessThan(300);
  expect((await request(app).post(`/api/shared-environments/${envId}/report`).set(authHeader(bob))
    .send({ reason: 'other', details: said('segnalazione ambiente') })).status).toBeLessThan(300);
  const suggestion = await request(app).post(`/api/shared-environments/${envId}/suggestions`).set(authHeader(bob)).send({
    message: said('messaggio della proposta'),
    items: [
      { itemType: 'annotation', payload: { normaKey: 'codice_civile', articleId: '1453', text: 'Nota proposta e accolta' } },
      { itemType: 'highlight', payload: { normaKey: 'codice_civile', articleId: '1453', anchorText: 'contratti', startOffset: 4 } },
      { itemType: 'quickNorm', payload: { label: 'Norma proposta e accolta', searchParams: { act_type: 'codice civile', article: '1453' } } },
      { itemType: 'alias', payload: { trigger: 'ris', aliasType: 'shortcut', expandTo: 'risoluzione' } },
      { itemType: 'dossier', payload: { title: 'Dossier proposto e accolto', entries: [{ note: 'Voce accolta' }] } },
      { itemType: 'annotation', payload: { articleId: '1453', text: said('proposta respinta') } },
      { itemType: 'annotation', payload: { articleId: '1453', text: said('proposta in attesa') } },
    ],
  });
  expect(suggestion.status, JSON.stringify(suggestion.body)).toBe(201);
  const items = suggestion.body.items as { id: string }[];
  for (const item of items.slice(0, 5)) {
    const taken = await request(app).post(`/api/shared-environments-suggestions/${suggestion.body.id}/items/${item.id}/take`).set(authHeader(alice));
    expect(taken.status).toBe(200);
  }
  const declined = await request(app).post(`/api/shared-environments-suggestions/${suggestion.body.id}/items/${items[5].id}/decline`)
    .set(authHeader(alice)).send({ reviewNote: 'Non fa al caso mio' });
  expect(declined.status).toBe(200);

  // Bob publishes, Alice downloads: a study dossier, notes and highlights credited to him, and an archived environment.
  const bobEnv = await request(app).post('/api/shared-environments').set(authHeader(bob)).send({
    title: 'Pubblicato da Bob', category: 'civil',
    content: {
      dossiers: [{ title: 'Dossier pubblicato', items: [{ id: 'n1', type: 'norma', data: { tipo_atto: 'codice civile', numero_articolo: '2043' } }] }],
      quickNorms: [],
      annotations: [{ normaKey: 'codice-civile--2043', articleId: '2043', text: 'Nota pubblicata' }],
      highlights: [{ normaKey: 'codice-civile--2043', articleId: '2043', text: 'Qualunque', color: 'green', startOffset: 0 }],
    },
  });
  expect(bobEnv.status).toBe(201);
  const downloaded = await request(app).post(`/api/shared-environments/${bobEnv.body.id}/download`).set(authHeader(alice))
    .send({ addNotes: true, addHighlights: true });
  expect(downloaded.status).toBe(201);
  // And the other way: Bob downloads Alice's, which is his world, not hers.
  await request(app).post(`/api/shared-environments/${envId}/download`).set(authHeader(bob)).send({});

  // An environment Alice imported by hand long ago: someone else's file, with their identity at any depth.
  await prisma.environment.create({
    data: {
      userId: alice.id, name: 'Importato a mano', author: bob.username,
      content: {
        dossiers: [{
          title: 'Dossier importato', userId: alice.id,
          items: [{ type: 'note', data: 'Nota mia', authorId: bob.id, Author_Id: bob.id, meta: { USERNAME: bob.username, Email: bob.email, user_id: bob.id } }],
        }],
        annotations: [{ text: 'Nota presa', userId: bob.id, originalAuthor: { id: bob.id, username: bob.username } }],
        sharedBy: { author_id: bob.id, username: bob.username, email: bob.email },
        proposals: [{ label: 'Proposta', suggester: { id: bob.id, username: bob.username }, user: { id: bob.id, username: bob.username } }],
        mine: { author: alice.username, Email: alice.email.toUpperCase(), user_id: alice.id },
      },
    },
  });

  // A dossier imported from a link keeps a note entry as the client sent it, and a snapshot copies it.
  await prisma.dossier.create({
    data: {
      userId: alice.id, name: 'Importato da un link',
      items: { create: [{ itemType: 'note', title: 'Nota', content: { text: 'Nota da un link', user: { id: bob.id, username: bob.username }, ownerId: bob.id } }] },
      snapshots: { create: [{ version: 1, content: { items: [{ content: { text: 'Nota da un link', authorUsername: bob.username } }] } }] },
    },
  });

  // Gymnasium: Bob votes on and studies Alice's card; Alice votes on Bob's.
  const aliceCard = await prisma.lingoCard.create({
    data: { autoreId: alice.id, materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione', domanda: 'Domanda di Alice', risposta: 'Risposta di Alice', stato: 'PROPOSTA_COMMUNITY' },
  });
  const bobCard = await prisma.lingoCard.create({
    data: { autoreId: bob.id, materia: 'DIRITTO_CIVILE', istituto: 'Rescissione', domanda: said('domanda'), risposta: said('risposta'), stato: 'PROPOSTA_COMMUNITY' },
  });
  await prisma.lingoValidazioneCard.create({ data: { cardId: aliceCard.id, utenteId: bob.id, giudizio: 'ERRATA', motivazione: said('motivazione') } });
  await prisma.lingoValidazioneCard.create({ data: { cardId: bobCard.id, utenteId: alice.id, giudizio: 'APPROVATA', motivazione: 'Il voto di Alice' } });
  await prisma.lingoRevisioneSRS.create({ data: { utenteId: bob.id, cardId: aliceCard.id, rating: 3, scheduledDays: 2, stability: 2, difficulty: 5 } });
  await prisma.lingoStatoRipasso.create({
    data: { utenteId: bob.id, cardId: aliceCard.id, stability: 2, difficulty: 5, dueAt: new Date(), lastReviewAt: new Date() },
  });
  const notice = await prisma.lingoTestoVersione.findFirstOrThrow({ where: { chiave: 'PROPOSTA_SCHEDA', versione: 1 } });
  await prisma.lingoAccettazioneTesto.create({ data: { utenteId: alice.id, testoId: notice.id } });
  await prisma.lingoAccettazioneTesto.create({ data: { utenteId: bob.id, testoId: notice.id } });

  // Notifications and Bob's own rows on the same norms as Alice's.
  const watch = await prisma.normaWatch.create({ data: { userId: bob.id, normaKey: 'codice_civile::art::1453', normaData: { note: said('norma seguita') } } });
  await prisma.normaChangeNotification.create({ data: { userId: bob.id, watchId: watch.id, normaKey: watch.normaKey, message: said('notifica'), snapshot: {} } });
  await prisma.annotation.create({ data: { userId: bob.id, normaKey: 'codice_civile::art::1453', content: said('nota sua') } });
  await prisma.dossier.create({ data: { userId: bob.id, name: said('dossier suo'), items: { create: [{ itemType: 'note', title: 'Nota', content: said('voce sua') }] } } });
  await prisma.feedback.create({ data: { userId: bob.id, type: 'other', message: said('feedback') } });

  // Alice's own rows, to be sure the export has something to say.
  await prisma.annotation.create({ data: { userId: alice.id, normaKey: 'codice_civile::art::1453', content: 'Nota di Alice' } });
  await prisma.dossier.create({ data: { userId: alice.id, name: 'Dossier di Alice', items: { create: [{ itemType: 'note', title: 'Nota', content: 'Voce di Alice' }] } } });
}

describe('the account export, against a second user who touches everything', () => {
  it('holds no id, name, email or text of the other user anywhere in the document', async () => {
    const alice = await createTestUser('export-alice');
    const bob = await createTestUser('export-sweep-bobq7');
    await seedBobEverywhere(alice, bob);

    const response = await request(app).get('/api/auth/export').set(authHeader(alice));

    expect(response.status).toBe(200);
    const exported = JSON.stringify(response.body);
    expect(exported).not.toContain(bob.id);
    expect(exported).not.toContain(bob.username);
    expect(exported).not.toContain(bob.email);
    expect(exported).not.toContain(BOB_SAYS);

    // And Alice's own data is all there.
    for (const hers of ['Testo di Alice', 'Risposta di Alice', 'Alice risponde a una risposta', 'Alice sotto la glossa di Bob',
      'Nota di Alice', 'Voce di Alice', 'Domanda di Alice', 'Il voto di Alice', 'Nota proposta e accolta', 'Norma proposta e accolta',
      'Dossier proposto e accolto', 'Voce accolta', 'Dossier pubblicato', 'Nota pubblicata', 'Nota mia', 'Nota presa', alice.id, alice.email]) {
      expect(exported).toContain(hers);
    }
  });

  it('keeps the user’s own identity in hand-imported content and drops the other’s, at any depth', async () => {
    const alice = await createTestUser('export-alice');
    const bob = await createTestUser('export-sweep-bobq7');
    await seedBobEverywhere(alice, bob);

    const response = await request(app).get('/api/auth/export').set(authHeader(alice));

    const env = (response.body.data.environments as { name: string; author: string | null; content: unknown }[])
      .find((e) => e.name === 'Importato a mano');
    expect(env).toMatchObject({ author: null });
    expect(env!.content).toEqual({
      dossiers: [{ title: 'Dossier importato', userId: alice.id, items: [{ type: 'note', data: 'Nota mia', meta: {} }] }],
      annotations: [{ text: 'Nota presa', fromAnotherUser: true }],
      sharedBy: {},
      proposals: [{ label: 'Proposta' }],
      mine: { author: alice.username, Email: alice.email.toUpperCase(), user_id: alice.id },
    });
    const fromLink = (response.body.data.dossiers as { name: string; items: { content: unknown }[]; snapshots: { content: unknown }[] }[])
      .find((d) => d.name === 'Importato da un link');
    expect(fromLink!.items[0].content).toEqual({ text: 'Nota da un link' });
    expect(fromLink!.snapshots[0].content).toEqual({ items: [{ content: { text: 'Nota da un link' } }] });
  });
});
