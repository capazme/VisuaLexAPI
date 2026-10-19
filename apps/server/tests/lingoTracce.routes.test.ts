import { beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { request, app, createTestUser, authHeader, prisma, type TestUser } from './helpers';

const BASE = '/api/lingo/simulazioni/tracce';
const TEXT = 'Tizio acquista da Caio un bene che si rivela difettoso. '.repeat(3);

const SUMMARY_KEYS = ['difficolta', 'fonteTraccia', 'id', 'materia', 'sottoTipoAtto', 'tipoProva', 'titolo'];

// The answer key carries a marker that must never appear in any response.
async function makeTraccia(overrides: Partial<Prisma.LingoTracciaUncheckedCreateInput> = {}) {
  return prisma.lingoTraccia.create({
    data: {
      materia: 'DIRITTO_CIVILE',
      tipoProva: 'ATTO_GIUDIZIARIO',
      sottoTipoAtto: 'comparsa_risposta',
      titolo: 'Traccia di prova',
      testoTraccia: TEXT,
      normeRiferimento: ['SEGRETO-NORME'],
      questioniForma: ['SEGRETO-FORMA'],
      questioniSostanza: ['SEGRETO-SOSTANZA'],
      fonteTraccia: 'sessione_2005',
      ...overrides,
    },
  });
}

describe('GET /api/lingo/simulazioni/tracce', () => {
  let alice: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('lingo-alice');
  });

  it('answers 401 without a token', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  it('lists the active traces, newest session first, with a total and no text', async () => {
    await makeTraccia({ titolo: 'Civile 2005', fonteTraccia: 'sessione_2005' });
    await makeTraccia({ titolo: 'Penale 2006', materia: 'DIRITTO_PENALE', fonteTraccia: 'sessione_2006' });
    await makeTraccia({ titolo: 'Civile 2006', fonteTraccia: 'sessione_2006' });

    const response = await request(app).get(BASE).set(authHeader(alice));

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(3);
    expect(response.body.items.map((t: { titolo: string }) => t.titolo)).toEqual(['Civile 2006', 'Penale 2006', 'Civile 2005']);
    for (const item of response.body.items) {
      expect(Object.keys(item).sort()).toEqual(SUMMARY_KEYS);
    }
  });

  it('filters by subject, kind of test and kind of act', async () => {
    await makeTraccia({ titolo: 'A' });
    await makeTraccia({ titolo: 'B', materia: 'DIRITTO_PENALE', sottoTipoAtto: 'appello_penale' });
    await makeTraccia({ titolo: 'C', tipoProva: 'PARERE_MOTIVATO', sottoTipoAtto: 'parere_motivato' });

    const titles = async (query: string) => {
      const response = await request(app).get(`${BASE}?${query}`).set(authHeader(alice));
      expect(response.status).toBe(200);
      return response.body.items.map((t: { titolo: string }) => t.titolo).sort();
    };

    expect(await titles('materia=DIRITTO_PENALE')).toEqual(['B']);
    expect(await titles('tipoProva=PARERE_MOTIVATO')).toEqual(['C']);
    expect(await titles('sottoTipoAtto=appello_penale')).toEqual(['B']);
    expect(await titles('materia=DIRITTO_CIVILE&tipoProva=ATTO_GIUDIZIARIO')).toEqual(['A']);
  });

  it('pages the results and says how many there are in all', async () => {
    for (let i = 1; i <= 5; i++) await makeTraccia({ titolo: `Traccia ${i}`, fonteTraccia: `sessione_200${i}` });

    const response = await request(app).get(`${BASE}?limit=2&offset=2`).set(authHeader(alice));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 5, limit: 2, offset: 2 });
    expect(response.body.items).toHaveLength(2);
  });

  it('gives a page of 50 by default', async () => {
    const response = await request(app).get(BASE).set(authHeader(alice));
    expect(response.body).toMatchObject({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it('hides the inactive traces', async () => {
    await makeTraccia({ titolo: 'Visibile' });
    await makeTraccia({ titolo: 'Ritirata', attiva: false });

    const response = await request(app).get(BASE).set(authHeader(alice));

    expect(response.body.total).toBe(1);
    expect(response.body.items.map((t: { titolo: string }) => t.titolo)).toEqual(['Visibile']);
  });

  it('never serialises the answer key', async () => {
    await makeTraccia();
    const response = await request(app).get(BASE).set(authHeader(alice));
    expect(JSON.stringify(response.body)).not.toContain('SEGRETO');
    for (const key of ['normeRiferimento', 'questioniForma', 'questioniSostanza']) {
      expect(response.body.items[0]).not.toHaveProperty(key);
    }
  });

  it.each([
    ['an unknown subject', 'materia=DIRITTO_TRIBUTARIO'],
    ['an unknown kind of test', 'tipoProva=ORALE'],
    ['a kind of act that is not a slug', 'sottoTipoAtto=Comparsa%20Risposta'],
    ['a limit of 0', 'limit=0'],
    ['a limit of 101', 'limit=101'],
    ['a limit that is not a number', 'limit=abc'],
    ['a negative offset', 'offset=-1'],
    ['an offset past any bank', 'offset=100001'],
    ['an absurd offset', 'offset=1e20'],
  ])('answers 400 for %s', async (_label, query) => {
    const response = await request(app).get(`${BASE}?${query}`).set(authHeader(alice));
    expect(response.status).toBe(400);
  });
});

describe('GET /api/lingo/simulazioni/tracce/:id', () => {
  let alice: TestUser;
  beforeEach(async () => {
    alice = await createTestUser('lingo-bob');
  });

  it('answers 401 without a token', async () => {
    const traccia = await makeTraccia();
    expect((await request(app).get(`${BASE}/${traccia.id}`)).status).toBe(401);
  });

  it('gives the trace with its text', async () => {
    const traccia = await makeTraccia({ titolo: 'Con testo', difficolta: 4 });

    const response = await request(app).get(`${BASE}/${traccia.id}`).set(authHeader(alice));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: traccia.id, titolo: 'Con testo', difficolta: 4, testoTraccia: TEXT });
    expect(Object.keys(response.body).sort()).toEqual([...SUMMARY_KEYS, 'testoTraccia'].sort());
  });

  it('never serialises the answer key', async () => {
    const traccia = await makeTraccia();
    const response = await request(app).get(`${BASE}/${traccia.id}`).set(authHeader(alice));
    expect(JSON.stringify(response.body)).not.toContain('SEGRETO');
    for (const key of ['normeRiferimento', 'questioniForma', 'questioniSostanza']) {
      expect(response.body).not.toHaveProperty(key);
    }
  });

  it('answers 404 for an inactive trace, as for one that does not exist', async () => {
    const inactive = await makeTraccia({ attiva: false });
    const hidden = await request(app).get(`${BASE}/${inactive.id}`).set(authHeader(alice));
    const missing = await request(app).get(`${BASE}/00000000-0000-4000-8000-000000000000`).set(authHeader(alice));
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(hidden.body).toEqual(missing.body);
  });

  it('answers 404 for an id that is not even an id', async () => {
    const response = await request(app).get(`${BASE}/abc`).set(authHeader(alice));
    expect(response.status).toBe(404);
  });
});
