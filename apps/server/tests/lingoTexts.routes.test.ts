import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma as serverPrisma } from '../src/lib/prisma';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';
import { delegated } from './delegatedHelper';

// The versions of the texts a person must accept (Studia PR B, Task B3; spec decision 22).

const NEW_VERSION = { titolo: 'Proponi la scheda', corpo: 'Primo.\n\nSecondo.', conferma: 'Accetto', azione: 'Proponi' };
const get = (who: TestUser, key = 'PROPOSTA_SCHEDA') => request(app).get(`/api/lingo/testi/${key}`).set(authHeader(who));
const list = (who: TestUser) => request(app).get('/api/admin/studia/testi').set(authHeader(who));
const save = (who: TestUser, body: unknown, key = 'PROPOSTA_SCHEDA') => request(app).post(`/api/admin/studia/testi/${key}`).set(authHeader(who)).send(body as object);

async function makeAdmin(name: string) {
  const user = await createTestUser(name);
  await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
  return user;
}

describe('GET /api/lingo/testi/:chiave', () => {
  let alice: TestUser;
  beforeEach(async () => { alice = await createTestUser('tx-alice'); });

  it('gives the current version, not accepted yet, then accepted after a proposal', async () => {
    const v1 = await prisma.lingoTestoVersione.findFirstOrThrow({ where: { chiave: 'PROPOSTA_SCHEDA', versione: 1 } });
    const before = await get(alice);
    expect(before.status).toBe(200);
    expect(before.body).toEqual({
      id: v1.id, chiave: 'PROPOSTA_SCHEDA', versione: 1, titolo: v1.titolo, corpo: v1.corpo, conferma: v1.conferma, azione: v1.azione, accettata: false,
    });
    const card = await prisma.lingoCard.create({ data: { autoreId: alice.id, materia: 'DIRITTO_CIVILE', istituto: 'I', domanda: 'D', risposta: 'R' } });
    expect((await request(app).post(`/api/lingo/cards/${card.id}/proponi`).set(authHeader(alice)).send({ accettoTestoId: v1.id })).status).toBe(200);
    expect((await get(alice)).body.accettata).toBe(true);
    expect((await get(await createTestUser('tx-bob'))).body.accettata).toBe(false);
  });

  it('gives version 2 as current once it exists, not accepted, and keeps asking per version', async () => {
    const v1 = await prisma.lingoTestoVersione.findFirstOrThrow({ where: { chiave: 'PROPOSTA_SCHEDA', versione: 1 } });
    await prisma.lingoAccettazioneTesto.create({ data: { utenteId: alice.id, testoId: v1.id } });
    expect((await get(alice)).body.accettata).toBe(true);
    await prisma.lingoTestoVersione.create({ data: { chiave: 'PROPOSTA_SCHEDA', versione: 2, ...NEW_VERSION } });
    const now = await get(alice);
    expect(now.body).toMatchObject({ versione: 2, ...NEW_VERSION, accettata: false });
  });

  it('answers 404 for an unknown key, including the names of Object’s own properties', async () => {
    for (const key of ['NOPE', 'proposta_scheda', 'constructor', '__proto__', 'toString']) expect((await get(alice, key)).status).toBe(404);
  });
});

describe('the administrator’s texts', () => {
  let admin: TestUser;
  let alice: TestUser;
  beforeEach(async () => {
    admin = await makeAdmin('tx-admin');
    alice = await createTestUser('tx-plain');
  });

  it('lists every version of each key, newest first, with the author’s username or null', async () => {
    await save(admin, NEW_VERSION);
    const response = await list(admin);
    expect(response.status).toBe(200);
    // Every key, each with its versions: the card proposal's, the MERL-T notice, the study material's declaration
    // and the Community's licence.
    expect(response.body.testi.map((t: { chiave: string }) => t.chiave).sort()).toEqual(['CONTRIBUTO_COMMUNITY', 'INFORMATIVA_MERLT', 'MATERIALE_STUDIO', 'PROPOSTA_SCHEDA']);
    const { versioni } = response.body.testi.find((t: { chiave: string }) => t.chiave === 'PROPOSTA_SCHEDA');
    expect(versioni.map((v: { versione: number }) => v.versione)).toEqual([2, 1]);
    expect(versioni[0]).toMatchObject({ ...NEW_VERSION, autore: 'tx-admin' });
    expect(versioni[0]).toHaveProperty('createdAt');
    expect(versioni[0]).toHaveProperty('id');
    expect(versioni[1].autore).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain(admin.id);
  });

  it('creates version 2 with the administrator as author, and leaves version 1 unchanged', async () => {
    const v1 = await prisma.lingoTestoVersione.findFirstOrThrow({ where: { chiave: 'PROPOSTA_SCHEDA', versione: 1 } });
    const response = await save(admin, { titolo: '  Titolo  ', corpo: 'Corpo', conferma: 'Ok', azione: 'Vai' });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ chiave: 'PROPOSTA_SCHEDA', versione: 2, titolo: 'Titolo', corpo: 'Corpo', conferma: 'Ok', azione: 'Vai', autore: 'tx-admin' });
    const stored = await prisma.lingoTestoVersione.findFirstOrThrow({ where: { chiave: 'PROPOSTA_SCHEDA', versione: 2 } });
    expect(stored.autoreId).toBe(admin.id);
    expect(await prisma.lingoTestoVersione.findUniqueOrThrow({ where: { id: v1.id } })).toEqual(v1);
    expect((await save(admin, NEW_VERSION)).body.versione).toBe(3);
  });

  it('answers 409 when another version took the number between the read and the write', async () => {
    // The race, made exact: another administrator's version 2 lands right after this request read version 1 as the highest.
    const delegate = serverPrisma.lingoTestoVersione;
    const real = delegate.aggregate.bind(delegate);
    const spy = vi.spyOn(delegate, 'aggregate').mockImplementationOnce(((args: Parameters<typeof real>[0]) =>
      real(args).then(async (read) => {
        await prisma.lingoTestoVersione.create({ data: { chiave: 'PROPOSTA_SCHEDA', versione: 2, ...NEW_VERSION, titolo: 'Dell’altro' } });
        return read;
      })) as never);
    try {
      const response = await save(admin, NEW_VERSION);
      expect(response.status).toBe(409);
      expect(response.body.detail).toContain('ricarica');
    } finally {
      spy.mockRestore();
    }
    const versions = await prisma.lingoTestoVersione.findMany({ where: { chiave: 'PROPOSTA_SCHEDA', versione: 2 } });
    expect(versions.map((v) => v.titolo)).toEqual(['Dell’altro']);
  });

  it('keeps every version number unique when saves are sent together', async () => {
    const all = await Promise.all([1, 2, 3, 4].map((n) => save(admin, { ...NEW_VERSION, titolo: `V${n}` })));
    const created = all.filter((r) => r.status === 201).length;
    expect(created).toBeGreaterThanOrEqual(1);
    expect(all.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const numbers = (await prisma.lingoTestoVersione.findMany({ where: { chiave: 'PROPOSTA_SCHEDA' } })).map((v) => v.versione).sort();
    expect(numbers).toEqual(Array.from({ length: created + 1 }, (_, i) => i + 1));
  });

  it('answers 403 to a non-admin on both routes, and writes nothing', async () => {
    expect((await list(alice)).status).toBe(403);
    expect((await save(alice, NEW_VERSION)).status).toBe(403);
    expect(await prisma.lingoTestoVersione.count({ where: { versione: { gt: 1 } } })).toBe(0);
  });

  it('answers 404 for an unknown key and 400 for a bad body', async () => {
    expect((await save(admin, NEW_VERSION, 'NOPE')).status).toBe(404);
    expect((await save(admin, NEW_VERSION, 'constructor')).status).toBe(404);
    expect((await save(admin, { ...NEW_VERSION, versione: 9 })).status).toBe(400);
    expect((await save(admin, { ...NEW_VERSION, autoreId: alice.id })).status).toBe(400);
    expect((await save(admin, { titolo: 'x' })).status).toBe(400);
    for (const [field, max] of [['titolo', 200], ['corpo', 8000], ['conferma', 120], ['azione', 120]] as const) {
      expect((await save(admin, { ...NEW_VERSION, [field]: '' })).status).toBe(400);
      expect((await save(admin, { ...NEW_VERSION, [field]: '   ' })).status).toBe(400);
      expect((await save(admin, { ...NEW_VERSION, [field]: 'x'.repeat(max + 1) })).status).toBe(400);
      expect((await save(admin, { ...NEW_VERSION, [field]: 'a\u0000b' })).status).toBe(400);
      expect((await save(admin, { ...NEW_VERSION, [field]: 'x'.repeat(max) })).status).toBe(201);
    }
  });

  it('stores and returns a body with markup as the same literal string', async () => {
    const corpo = '<script>alert(1)</script>\n\n**non** <b>markdown</b>';
    const saved = await save(admin, { ...NEW_VERSION, corpo, titolo: '<img src=x onerror=alert(1)>' });
    expect(saved.status).toBe(201);
    expect(saved.body.corpo).toBe(corpo);
    const seen = await get(alice);
    expect(seen.body.corpo).toBe(corpo);
    expect(seen.body.titolo).toBe('<img src=x onerror=alert(1)>');
    expect((await list(admin)).body.testi[0].versioni[0].corpo).toBe(corpo);
  });

  it('refuses an exchanged token on the texts and on both admin routes', async () => {
    const token = await delegated(admin, 'lingo:cards:read');
    expect((await request(app).get('/api/lingo/testi/PROPOSTA_SCHEDA').set(token)).status).toBe(403);
    expect((await request(app).get('/api/admin/studia/testi').set(token)).status).toBe(403);
    expect((await request(app).post('/api/admin/studia/testi/PROPOSTA_SCHEDA').set(token).send(NEW_VERSION)).status).toBe(403);
    expect(await prisma.lingoTestoVersione.count({ where: { versione: { gt: 1 } } })).toBe(0);
  });
});
