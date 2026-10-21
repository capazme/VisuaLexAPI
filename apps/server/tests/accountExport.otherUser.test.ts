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
      // A search is the proposer's JSON, stored as it came: Bob's identity in it, under any key.
      {
        itemType: 'quickNorm',
        payload: {
          label: 'Norma proposta e accolta',
          searchParams: {
            act_type: 'codice civile', article: '1453',
            proposedBy: { id: bob.id, name: 'Bob Q7' }, authorId: bob.id, ref: `user:${bob.id}`, originalAuthorUsername: bob.username,
            filters: [{ field: 'anno', originalAuthorId: bob.id }],
          },
        },
      },
      {
        itemType: 'alias',
        payload: {
          trigger: 'ris', aliasType: 'reference', expandTo: 'risoluzione',
          searchParams: { act_type: 'codice civile', article: '1453', by: { uid: bob.id, displayName: 'Bob Q7', email: bob.email }, utenteId: bob.id },
        },
      },
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
  // Gymnasium XP: Alice's credit for her vote on Bob's card, Bob's for his vote on hers and his own proposal.
  const theirVote = await prisma.lingoValidazioneCard.findFirstOrThrow({ where: { utenteId: bob.id } });
  const herVote = await prisma.lingoValidazioneCard.findFirstOrThrow({ where: { utenteId: alice.id } });
  const today = new Date('2026-10-20T00:00:00Z');
  await prisma.lingoCreditoXp.create({ data: { utenteId: alice.id, missione: 'CONVALIDA', periodo: 'G:2026-10-20', giorno: today, punti: 20, fonte: 'VOTO', fonteId: herVote.id } });
  await prisma.lingoCreditoXp.create({ data: { utenteId: bob.id, missione: 'CONVALIDA', periodo: 'G:2026-10-20', giorno: today, punti: 20, fonte: 'VOTO', fonteId: theirVote.id } });
  await prisma.lingoCreditoXp.create({ data: { utenteId: bob.id, missione: 'SCRIVI', periodo: 'G:2026-10-20', giorno: today, punti: 25, fonte: 'PROPOSTA', fonteId: bobCard.id, materia: 'DIRITTO_CIVILE' } });

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
    expect(exported).not.toContain('Bob Q7');

    // And Alice's own data is all there.
    for (const hers of ['Testo di Alice', 'Risposta di Alice', 'Alice risponde a una risposta', 'Alice sotto la glossa di Bob',
      'Nota di Alice', 'Voce di Alice', 'Domanda di Alice', 'Il voto di Alice', 'Nota proposta e accolta', 'Norma proposta e accolta', 'risoluzione',
      'Dossier proposto e accolto', 'Voce accolta', 'Dossier pubblicato', 'Nota pubblicata', 'Nota mia', 'Nota presa', alice.id, alice.email]) {
      expect(exported).toContain(hers);
    }
    // Her XP: her own credit, not Bob's, and no event's id (a vote's id would name a row about Bob's card).
    expect(response.body.data.lingoCreditiXp).toEqual([{ missione: 'CONVALIDA', periodo: 'G:2026-10-20', giorno: '2026-10-20', punti: 20, fonte: 'VOTO', materia: null }]);
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

  it('keeps of a search taken from a proposal only the search', async () => {
    const alice = await createTestUser('export-alice');
    const bob = await createTestUser('export-sweep-bobq7');
    await seedBobEverywhere(alice, bob);

    const response = await request(app).get('/api/auth/export').set(authHeader(alice));

    const [norm] = response.body.data.quickNorms as { label: string; searchParams: unknown; fromAnotherUser: boolean }[];
    expect(norm).toMatchObject({ label: 'Norma proposta e accolta', fromAnotherUser: true });
    // A search stays a search: the row says it was taken, its parameters do not.
    expect(norm.searchParams).toEqual({ act_type: 'codice civile', article: '1453', ref: 'user:[altro utente]', filters: [{ field: 'anno' }] });
    const [alias] = response.body.data.customAliases as { trigger: string; searchParams: unknown }[];
    expect(alias.searchParams).toEqual({ act_type: 'codice civile', article: '1453' });
  });

  it('reads a person by its shape: names and ids of someone else go, under any key; the user’s own stay', async () => {
    const alice = await createTestUser('export-alice');
    const bob = await createTestUser('export-sweep-bobq7');
    const content = {
      rows: [
        { text: 'Riga 1', originalAuthorUsername: bob.username, originalAuthorName: 'Bob Q7', originalAuthorEmail: bob.email },
        // Any `originalAuthor…` key is the attribution, whatever follows the prefix.
        { text: 'Riga 1b', originalAuthorDisplayName: 'Bob Q7', original_author_full_name: 'Bob Q7', ORIGINALAUTHORNICK: 'bq7' },
        { text: 'Riga 2', displayName: 'Bob Q7', fullName: 'Bob Q7', autoreId: bob.id, utente_id: bob.id, kind: 'nota' },
        // Bob's own record, under keys no list names: it goes whole, with what else it holds.
        { text: 'Riga 3', curator: { id: bob.id, name: 'Bob Q7', bio: 'Bob Q7 bio' }, team: [{ id: bob.id, name: 'Bob Q7' }, 'Alice'] },
        // An id beside a key only a person has, whatever the id is called: ids and names go.
        { text: 'Riga 4', curator: { key: 'k1', person_ref_id: 'not-a-user', displayName: 'Bob Q7', role: 'curatore' } },
        // A user's id or email anywhere: alone it goes, as a key too; inside a text it is covered.
        {
          text: 'Riga 5', ref: bob.id, link: `https://example.org/u/${bob.id.toUpperCase()}`, seen: [bob.id, 'altro'], [bob.id]: true,
          contact: bob.email.toUpperCase(), note: `Scrivere a mailto:${bob.email}. Grazie`,
          quote: `Scrivere a «${bob.email}» o a “${bob.email}”, email:${bob.email}, ${bob.email}/ufficio, mailto:${bob.email.toUpperCase()}?subject=x`,
        },
        // Another user's id under any id key, beside a name, with no id of its own: ids and names go.
        { text: 'Riga 6', proposedBy: { authorId: bob.id, name: 'Bob Q7', role: 'proponente' }, by: { uploader_id: bob.id, name: 'Bob Q7' } },
        // The user's id beside someone else's: not the user's record.
        { text: 'Riga 7', invite: { ownerId: alice.id, inviteeId: 'ext-1', fullName: 'Bob Q7', when: 'oggi' } },
        // A user's id under a key that does not look like an id's is still an id.
        { text: 'Riga 8', by: { userid: bob.id, name: 'Bob Q7', role: 'a' }, BY: { AUTHORID: bob.id, name: 'Bob Q7', role: 'b' } },
      ],
      // Not ids: `paid`, `valid`. A client's name stays; an email under the email key goes, as ever.
      client: { email: 'cliente@studio.example', name: 'Cliente Rossi', paid: 'si', valid: 'no' },
      meUpper: { id: alice.id.toUpperCase(), displayName: 'Alice' },
      // A dossier's and an environment's id and name are not a person, nor the user's own id beside them.
      dossier: { id: 'd-1', name: 'Dossier di Alice', userId: alice.id },
      // The user's own folder, with no id of its own: the user's id beside a name is not a person.
      folder: { name: 'Fascicolo Rossi', userId: alice.id, folderId: 'f-1' },
      // The user's own record keeps its names.
      me: { id: alice.id, name: 'Alice A.', displayName: 'Alice', friend: { id: bob.id, name: 'Bob Q7' } },
      meByEmail: { uid: 'local-1', email: alice.email, fullName: 'Alice A.' },
    };
    await prisma.environment.create({ data: { userId: alice.id, name: 'Forme di persona', content } });

    const response = await request(app).get('/api/auth/export').set(authHeader(alice));

    const env = (response.body.data.environments as { name: string; content: unknown }[]).find((e) => e.name === 'Forme di persona');
    expect(env!.content).toEqual({
      rows: [
        { text: 'Riga 1', fromAnotherUser: true },
        { text: 'Riga 1b', fromAnotherUser: true },
        { text: 'Riga 2', kind: 'nota' },
        { text: 'Riga 3', team: ['Alice'] },
        { text: 'Riga 4', curator: { key: 'k1', role: 'curatore' } },
        {
          text: 'Riga 5', link: 'https://example.org/u/[altro utente]', seen: ['altro'], note: 'Scrivere a mailto:[altro utente]. Grazie',
          quote: 'Scrivere a «[altro utente]» o a “[altro utente]”, email:[altro utente], [altro utente]/ufficio, mailto:[altro utente]?subject=x',
        },
        { text: 'Riga 6', proposedBy: { role: 'proponente' }, by: {} },
        { text: 'Riga 7', invite: { when: 'oggi' } },
        { text: 'Riga 8', by: { role: 'a' }, BY: { role: 'b' } },
      ],
      client: { name: 'Cliente Rossi', paid: 'si', valid: 'no' },
      meUpper: { id: alice.id.toUpperCase(), displayName: 'Alice' },
      dossier: { id: 'd-1', name: 'Dossier di Alice', userId: alice.id },
      folder: { name: 'Fascicolo Rossi', userId: alice.id, folderId: 'f-1' },
      me: { id: alice.id, name: 'Alice A.', displayName: 'Alice' },
      meByEmail: { uid: 'local-1', email: alice.email, fullName: 'Alice A.' },
    });
    const exported = JSON.stringify(response.body);
    expect(exported).not.toContain(bob.id);
    expect(exported.toLowerCase()).not.toContain(bob.id.toLowerCase());
    expect(exported).not.toContain('Bob Q7');
    expect(exported.toLowerCase()).not.toContain(bob.email.toLowerCase());
  });
});
