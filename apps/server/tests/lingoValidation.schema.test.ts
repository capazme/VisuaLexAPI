import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { request, app, createTestUser, authHeader, prisma, type TestUser } from './helpers';

async function proposedCard(authorId: string) {
  return prisma.lingoCard.create({
    data: { autoreId: authorId, materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione', domanda: 'D', risposta: 'R', stato: 'PROPOSTA_COMMUNITY' },
  });
}

describe('the notice to accept, as the migration leaves it', () => {
  it('has exactly one version of PROPOSTA_SCHEDA, number 1, whose body names the licence', async () => {
    const versions = await prisma.lingoTestoVersione.findMany({ where: { chiave: 'PROPOSTA_SCHEDA' } });
    expect(versions).toHaveLength(1);
    expect(versions[0].versione).toBe(1);
    expect(versions[0].corpo).toContain('CC BY-SA 4.0');
    expect(versions[0].autoreId).toBeNull();
  });

  it('carries the wording of the specification, paragraphs separated by one blank line', async () => {
    const v = await prisma.lingoTestoVersione.findFirstOrThrow({ where: { chiave: 'PROPOSTA_SCHEDA', versione: 1 } });
    expect(v.titolo).toBe('Proponi la scheda alla comunità');
    expect(v.conferma).toBe('Ho letto e accetto');
    expect(v.azione).toBe('Proponi');
    const paragraphs = v.corpo.split('\n\n');
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]).toContain('Attribuzione – Condividi allo stesso modo 4.0');
    expect(paragraphs[1]).toMatch(/^Se viene validata, la scheda resta anche se cancelli il tuo account/);
    expect(paragraphs[2]).toBe('Finché è in attesa di validazione puoi ritirarla e tornerà una tua bozza.');
    for (const p of paragraphs) expect(p).not.toMatch(/^\s|\s$|\n/);
  });
});

describe('what the database holds firm', () => {
  let alice: TestUser;
  beforeEach(async () => { alice = await createTestUser('schema-alice'); });

  it('refuses to delete a text version that an acceptance points to', async () => {
    const v = await prisma.lingoTestoVersione.findFirstOrThrow({ where: { chiave: 'PROPOSTA_SCHEDA', versione: 1 } });
    await prisma.lingoAccettazioneTesto.create({ data: { utenteId: alice.id, testoId: v.id } });
    const attempt = prisma.lingoTestoVersione.delete({ where: { id: v.id } });
    await expect(attempt).rejects.toMatchObject({ code: 'P2003' });
    await expect(attempt).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(await prisma.lingoTestoVersione.findUnique({ where: { id: v.id } })).not.toBeNull();
  });

  it('refuses to delete a text version a card was proposed under', async () => {
    const v = await prisma.lingoTestoVersione.findFirstOrThrow({ where: { chiave: 'PROPOSTA_SCHEDA', versione: 1 } });
    const card = await proposedCard(alice.id);
    await prisma.lingoCard.update({ where: { id: card.id }, data: { propostaTestoId: v.id } });
    await expect(prisma.lingoTestoVersione.delete({ where: { id: v.id } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('accepts a version number once per key', async () => {
    await expect(
      prisma.lingoTestoVersione.create({ data: { chiave: 'PROPOSTA_SCHEDA', versione: 1, titolo: 'T', corpo: 'C', conferma: 'Ok', azione: 'Vai' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('lets two anonymous votes sit on the same card without colliding on the unique index', async () => {
    const card = await proposedCard(alice.id);
    await prisma.lingoValidazioneCard.create({ data: { cardId: card.id, utenteId: null, giudizio: 'APPROVATA' } });
    await prisma.lingoValidazioneCard.create({ data: { cardId: card.id, utenteId: null, giudizio: 'APPROVATA' } });
    expect(await prisma.lingoValidazioneCard.count({ where: { cardId: card.id } })).toBe(2);
  });

  it('refuses a second vote of the same validator on the same card', async () => {
    const card = await proposedCard(alice.id);
    const carol = await createTestUser('schema-carol');
    await prisma.lingoValidazioneCard.create({ data: { cardId: card.id, utenteId: carol.id, giudizio: 'APPROVATA' } });
    await expect(
      prisma.lingoValidazioneCard.create({ data: { cardId: card.id, utenteId: carol.id, giudizio: 'ERRATA', motivazione: 'x' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('removes a card’s votes with the card', async () => {
    const card = await proposedCard(alice.id);
    await prisma.lingoValidazioneCard.create({ data: { cardId: card.id, utenteId: null, giudizio: 'APPROVATA' } });
    await prisma.lingoCard.delete({ where: { id: card.id } });
    expect(await prisma.lingoValidazioneCard.count()).toBe(0);
  });

  it('starts every user as a non-validator', async () => {
    expect((await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).lingoValidatore).toBe(false);
  });
});

describe('the validator flag, from the administrator’s page', () => {
  let admin: TestUser;
  let carol: TestUser;
  beforeEach(async () => {
    admin = await createTestUser('flag-admin');
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
    carol = await createTestUser('flag-carol');
  });

  it('sets and clears lingoValidatore', async () => {
    const set = await request(app).put(`/api/admin/users/${carol.id}`).set(authHeader(admin)).send({ lingoValidatore: true });
    expect(set.status).toBe(200);
    expect(set.body.lingo_validatore).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: carol.id } })).lingoValidatore).toBe(true);

    const cleared = await request(app).put(`/api/admin/users/${carol.id}`).set(authHeader(admin)).send({ lingoValidatore: false });
    expect(cleared.status).toBe(200);
    expect(cleared.body.lingo_validatore).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: carol.id } })).lingoValidatore).toBe(false);
  });

  it('leaves the flag alone when the body does not mention it', async () => {
    await prisma.user.update({ where: { id: carol.id }, data: { lingoValidatore: true } });
    const response = await request(app).put(`/api/admin/users/${carol.id}`).set(authHeader(admin)).send({ isVerified: true });
    expect(response.status).toBe(200);
    expect(response.body.lingo_validatore).toBe(true);
  });

  it('refuses a flag that is not a boolean', async () => {
    const response = await request(app).put(`/api/admin/users/${carol.id}`).set(authHeader(admin)).send({ lingoValidatore: 'yes' });
    expect(response.status).toBe(400);
  });

  it('shows the flag in the list, in one user and in the answer to a creation', async () => {
    await prisma.user.update({ where: { id: carol.id }, data: { lingoValidatore: true } });
    const list = await request(app).get('/api/admin/users').set(authHeader(admin));
    expect(list.status).toBe(200);
    const row = list.body.find((u: { id: string }) => u.id === carol.id);
    expect(row.lingo_validatore).toBe(true);
    expect(list.body.find((u: { id: string }) => u.id === admin.id).lingo_validatore).toBe(false);

    const one = await request(app).get(`/api/admin/users/${carol.id}`).set(authHeader(admin));
    expect(one.body.lingo_validatore).toBe(true);

    const created = await request(app)
      .post('/api/admin/users')
      .set(authHeader(admin))
      .send({ email: 'flag-new@test.local', username: 'flag-new', password: 'secret' });
    expect(created.status).toBe(201);
    expect(created.body.lingo_validatore).toBe(false);
  });

  it('answers 403 to a user who is not an administrator', async () => {
    const response = await request(app).put(`/api/admin/users/${carol.id}`).set(authHeader(carol)).send({ lingoValidatore: true });
    expect(response.status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: carol.id } })).lingoValidatore).toBe(false);
  });
});
