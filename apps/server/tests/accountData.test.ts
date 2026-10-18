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
    expect(response.body.data.lingoRipassi).toEqual([]);
    expect(response.body.data.lingoPreferenze).toBeNull();
    expect(response.body.data.lingoGiornate).toEqual([]);
  });

  it('exports the study days and the review goal', async () => {
    await prisma.lingoPreferenzeStudio.create({ data: { utenteId: alice.id, ripassiAlGiorno: 15 } });
    await prisma.lingoGiornataStudio.create({ data: { utenteId: alice.id, giorno: new Date('2026-10-19T00:00:00Z'), ripassi: 12, nuove: 3, sbagliate: 2, valido: true } });
    const response = await request(app).get('/api/auth/export').set(authHeader(alice));
    expect(response.body.data.lingoPreferenze).toEqual({ nuoveAlGiorno: 20, ripassiAlGiorno: 15, materieComunita: [] });
    expect(response.body.data.lingoGiornate).toEqual([{ giorno: '2026-10-19', ripassi: 12, nuove: 3, sbagliate: 2, codaFinita: false, valido: true }]);
  });

  it('requires the current password and exact confirmation before deletion', async () => {
    const rejected = await request(app).delete('/api/auth/account').set(authHeader(alice)).send({ password: 'wrong', confirmation: 'ELIMINA ACCOUNT' });
    expect(rejected.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { id: alice.id } })).not.toBeNull();

    const deleted = await request(app).delete('/api/auth/account').set(authHeader(alice)).send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' });
    expect(deleted.status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: alice.id } })).toBeNull();
  });

  it('exports a validator’s votes and acceptances, and nobody else’s', async () => {
    const bob = await createTestUser('account-bob');
    await prisma.user.update({ where: { id: alice.id }, data: { lingoValidatore: true } });
    const author = await createTestUser('account-author');
    const card = await prisma.lingoCard.create({
      data: { autoreId: author.id, materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione', domanda: 'D', risposta: 'R', stato: 'PROPOSTA_COMMUNITY' },
    });
    const version = await prisma.lingoTestoVersione.findFirstOrThrow({ where: { chiave: 'PROPOSTA_SCHEDA', versione: 1 } });
    await prisma.lingoValidazioneCard.create({ data: { cardId: card.id, utenteId: alice.id, giudizio: 'ERRATA', motivazione: 'Manca il presupposto.' } });
    await prisma.lingoValidazioneCard.create({ data: { cardId: card.id, utenteId: bob.id, giudizio: 'APPROVATA' } });
    await prisma.lingoAccettazioneTesto.create({ data: { utenteId: alice.id, testoId: version.id } });
    await prisma.lingoAccettazioneTesto.create({ data: { utenteId: bob.id, testoId: version.id } });

    const response = await request(app).get('/api/auth/export').set(authHeader(alice));

    expect(response.status).toBe(200);
    expect(response.body.schemaVersion).toBe(1);
    const { lingoValidazioni, lingoAccettazioni } = response.body.data;
    expect(lingoValidazioni).toEqual([
      { cardId: card.id, giudizio: 'ERRATA', motivazione: 'Manca il presupposto.', createdAt: expect.any(String) },
    ]);
    expect(lingoAccettazioni).toEqual([
      { chiave: 'PROPOSTA_SCHEDA', versione: 1, acceptedAt: expect.any(String) },
    ]);
  });

  it('has empty lists for a user who never voted or accepted', async () => {
    const response = await request(app).get('/api/auth/export').set(authHeader(alice));
    expect(response.body.data.lingoValidazioni).toEqual([]);
    expect(response.body.data.lingoAccettazioni).toEqual([]);
  });
});
