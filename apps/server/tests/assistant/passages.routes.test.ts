import nock from 'nock';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from '../helpers';
import { delegatedToken } from '../oauth/oauthHelpers';
import { delegatedQuotaStatus } from '../../src/middleware/delegated';
import { ARTICLE_FIXTURES } from '../../../web/src/utils/__fixtures__/articleTexts';

// D7b and D8, the connected application's side (spec §8.4, §8.7): an entry's text, and glosses proposed on its
// passages, found in the text the reader reads, stored as the assistant's notes with no colour. Coloured passages
// are no longer proposed: 410.

const API = 'http://legal-api.test';
const originalLegalApiUrl = process.env.LEGAL_API_URL;
const RAW = ARTICLE_FIXTURES.find((f) => f.id === 'nrm-cc-1453')!.text;
const NORM = { tipo_atto: 'codice civile', numero_articolo: '1453', data: '1942-03-16', numero_atto: '262', urn: 'urn:x~art1453' };
const KEY = 'codice-civile--262--1942-03-16--1453::art::1453';
const SENTENZA = {
  corte: 'cassazione', archivio: 'penale', numero: 10787, anno: 2024, sezione: '7', tipo: 'sentenza',
  data_deposito: '2024-03-12', etichetta: 'Cass. pen., sez. VII, sent. dep. 12 marzo 2024, n. 10787',
};
const DECISION_TEXT = {
  epigrafe: '  REPUBBLICA ITALIANA\nLA CORTE SUPREMA DI CASSAZIONE  ',
  motivazione: 'RITENUTO IN FATTO\n\nIl ricorrente lamenta la violazione\ndell’art. 640 c.p. nella parte in cui la Corte di appello ha escluso il dolo.',
  dispositivo: 'P.Q.M.\n\nRigetta il ricorso.',
};

let articleBodies: Record<string, string>[] = [];
let validity: Record<string, unknown> | undefined;
let articleStatus = 200;

beforeAll(() => nock.activate());
afterAll(() => nock.restore());

async function switchOn(enabled = true, key = 'assistant_glosses') {
  await prisma.appSwitch.upsert({ where: { key }, create: { key, enabled }, update: { enabled } });
}

/** A coloured passage an application proposed before D8, as the old route stored it. */
function savedMark(userId: string, itemId: string, text: string, startOffset: number, over: { note?: string | null; clientId?: string } = {}) {
  const note = over.note === undefined ? null : over.note;
  return prisma.highlight.create({
    data: {
      userId, normaKey: KEY, text, color: 'green', startOffset, endOffset: startOffset + text.length, note,
      createdByClientId: over.clientId ?? 'client-1', createdByClientName: 'Claude Code', dossierItemId: itemId,
      assistantText: text, assistantStartOffset: startOffset, assistantNote: note, noteState: note === null ? null : 'proposed',
    },
  });
}

describe('D7b and D8 — an entry’s text and the glosses proposed on it', () => {
  let alice: TestUser;
  let dossierId: string;
  let normId: string;
  let decisionId: string;
  let noteId: string;
  let token: string;
  const as = () => ({ Authorization: `Bearer ${token}` });
  const text = (itemId = normId, query = '') => request(app).get(`/api/dossiers/${dossierId}/items/${itemId}/text${query}`).set(as());
  const gloss = (glosse: unknown, itemId = normId, who = as()) =>
    request(app).post(`/api/dossiers/${dossierId}/items/${itemId}/glosses`).set(who).send({ glosse });

  beforeEach(async () => {
    process.env.LEGAL_API_URL = API;
    articleBodies = [];
    validity = { state: 'current', valid_from: '1942-04-21', valid_to: null, request_in_window: null };
    articleStatus = 200;
    nock(API).post('/fetch_article_text').times(500).reply((_uri: string, body: Record<string, string>) => {
      articleBodies.push(body);
      return [articleStatus, [{ article_text: RAW, norma_data: NORM, url: 'https://www.normattiva.it/x', ...(validity ? { validity } : {}) }]];
    });
    nock(API).post('/fetch_decision').times(500).reply(() => [200, { esito: 'trovata', identita: { corte: 'cassazione', archivio: 'penale', numero: 10787, anno: 2024 }, attributi: {}, testo: DECISION_TEXT }]);
    alice = await createTestUser('passages-alice');
    dossierId = (await request(app).post('/api/dossiers').set(authHeader(alice)).send({ name: 'Pratica' })).body.id;
    const add = (body: object) => request(app).post(`/api/dossiers/${dossierId}/items`).set(authHeader(alice)).send(body);
    normId = (await add({ itemType: 'norm', title: 'Art. 1453', content: { ...NORM, _dossierMeta: { important: true } } })).body.id;
    decisionId = (await add({ itemType: 'sentenza', title: 'x', content: SENTENZA })).body.id;
    noteId = (await add({ itemType: 'note', title: 'Nota', content: 'Mia nota.' })).body.id;
    token = (await delegatedToken(alice, 'dossier:read dossier:write dossier:text')).apiToken;
    await switchOn();
  });

  afterEach(() => {
    nock.cleanAll();
    if (originalLegalApiUrl === undefined) delete process.env.LEGAL_API_URL;
    else process.env.LEGAL_API_URL = originalLegalApiUrl;
  });

  describe('GET …/text', () => {
    it('gives the article’s text as the reader reads it, asked with the reader’s body', async () => {
      const response = await text();
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        voce: { id: normId, tipo: 'norm', riferimento: 'art. 1453 c.c.' },
        in_vigore: true,
        parte: 1,
        parti: 1,
        testo: RAW,
        glosse: [],
      });
      expect(articleBodies).toEqual([{ act_type: 'codice civile', act_number: '262', date: '1942-03-16', article: '1453', version: 'vigente', version_date: '' }]);
    });

    it('gives a decision’s blocks under their names', async () => {
      const response = await text(decisionId);
      expect(response.status).toBe(200);
      expect(response.body.voce).toMatchObject({ tipo: 'sentenza', riferimento: SENTENZA.etichetta });
      expect(response.body.testo).toBe(
        'Epigrafe\nREPUBBLICA ITALIANA\nLA CORTE SUPREMA DI CASSAZIONE\n\nMotivazione\nRITENUTO IN FATTO\n\nIl ricorrente lamenta la violazione\ndell’art. 640 c.p. nella parte in cui la Corte di appello ha escluso il dolo.\n\nDispositivo\nP.Q.M.\n\nRigetta il ricorso.',
      );
    });

    it('says a past text is not in force, and still gives it', async () => {
      validity = { state: 'historical', valid_from: '1942-04-21', valid_to: '2000-01-01' };
      const response = await text();
      expect(response.body.in_vigore).toBe(false);
      expect(response.body.testo).toBe(RAW);
    });

    it('refuses a note, a source that cannot answer, and another user’s dossier', async () => {
      expect((await text(noteId)).body.detail).toBe('Questa voce non ha un testo: è una nota.');
      articleStatus = 502;
      expect((await text()).status).toBe(503);
      const bob = await createTestUser('passages-bob');
      const bobToken = (await delegatedToken(bob, 'dossier:read dossier:text')).apiToken;
      expect((await request(app).get(`/api/dossiers/${dossierId}/items/${normId}/text`).set({ Authorization: `Bearer ${bobToken}` })).status).toBe(404);
    });

    it('needs dossier:text', async () => {
      const without = (await delegatedToken(alice, 'dossier:read dossier:write')).apiToken;
      const response = await request(app).get(`/api/dossiers/${dossierId}/items/${normId}/text`).set({ Authorization: `Bearer ${without}` });
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('insufficient_scope');
    });

    it('lists only the glosses the user has not taken up, as the model wrote them', async () => {
      await gloss([
        { testo: 'il risarcimento del danno', nota: 'Danno.' },
        { testo: 'la risoluzione del contratto', nota: 'Rimedio.' },
        { testo: "Dalla data della domanda di risoluzione l'inadempiente", nota: 'Termine.' },
      ]);
      const rows = await prisma.highlight.findMany({ where: { dossierItemId: normId }, orderBy: { startOffset: 'asc' } });
      // The user validates one gloss, flags another, and moves the boundaries of the third.
      const projection = RAW.replace(/\n/g, '');
      const byText = (t: string) => rows.find((r) => r.text === t)!;
      await prisma.highlight.update({ where: { id: byText("Dalla data della domanda di risoluzione l'inadempiente").id }, data: { noteState: 'validated' } });
      await prisma.highlight.update({ where: { id: byText('la risoluzione del contratto').id }, data: { noteState: 'review' } });
      await prisma.highlight.update({ where: { id: byText('il risarcimento del danno').id }, data: { startOffset: 1, text: projection.slice(1, 5) } });
      // A coloured passage saved before D8, and a highlight of the user's own, are never listed.
      await savedMark(alice.id, normId, 'la risoluzione del contratto', projection.indexOf('la risoluzione del contratto'), { note: 'Vecchia.' });
      await request(app).post('/api/highlights').set(authHeader(alice)).send({ normaKey: KEY, text: 'contratti', color: 'red', startOffset: 50, endOffset: 59 });
      const response = await text();
      expect(response.body.glosse).toEqual([{ testo: 'il risarcimento del danno', nota: 'Danno.' }]);
      expect(response.body).not.toHaveProperty('proposte');
    });

    it('lists another application’s glosses to no one but it, and reads nothing for a session', async () => {
      await gloss([{ testo: 'il risarcimento del danno', nota: 'Fatti della pratica.' }]);
      const other = (await delegatedToken(alice, 'dossier:read dossier:write dossier:text')).apiToken;
      const seen = await request(app).get(`/api/dossiers/${dossierId}/items/${normId}/text`).set({ Authorization: `Bearer ${other}` });
      expect(seen.body.glosse).toEqual([]);
      expect((await text()).body.glosse).toHaveLength(1);
      const session = await request(app).get(`/api/dossiers/${dossierId}/items/${normId}/text`).set(authHeader(alice));
      expect(session.status).toBe(403);
    });

    it('reads with every switch off: quoting an entry verbatim is behind none (G-372)', async () => {
      await switchOn(false);
      await switchOn(false, 'assistant_passages');
      const response = await text();
      expect(response.status).toBe(200);
      expect(response.body.testo).toBe(RAW);
    });

    it('says a decision the source does not know has no text to read, not «try again»', async () => {
      nock.cleanAll();
      nock(API).post('/fetch_decision').times(5).reply(() => [404, { esito: 'non_trovata', motivo: 'inesistente' }]);
      const response = await text(decisionId);
      expect(response.status).toBe(400);
      expect(response.body.detail).toBe('La fonte non ha il testo di questa voce: controlla la norma o la sentenza nel dossier.');
    });

    it('says plainly when the source has no such article, and when the entry’s data are incomplete', async () => {
      nock.cleanAll();
      let answer: [number, unknown] = [200, [{ error: 'Document not found for codice civile art. 1453', norma_data: NORM }]];
      nock(API).post('/fetch_article_text').times(10).reply(() => answer);
      const missing = await text();
      expect(missing.status).toBe(400);
      expect(missing.body.detail).toBe('La fonte non ha il testo di questa voce: controlla la norma o la sentenza nel dossier.');
      answer = [400, { error: 'Invalid act type' }];
      expect((await text()).status).toBe(400);
      // A failure that is not «not there» stays a 503: asking again may help.
      answer = [200, [{ error: 'Circuit open for normattiva', norma_data: NORM }]];
      expect((await text()).status).toBe(503);
      const broken = await prisma.dossierItem.create({ data: { dossierId, itemType: 'norm', title: 'x', content: { numero_articolo: '1' } } });
      const incomplete = await text(broken.id);
      expect(incomplete.status).toBe(400);
      expect(incomplete.body.detail).toBe('I dati di questa norma nel dossier sono incompleti: aggiungila di nuovo.');
      // A number stored as a number is read as the web reads it.
      answer = [200, [{ article_text: RAW, norma_data: NORM, validity }]];
      const numbered = await prisma.dossierItem.create({ data: { dossierId, itemType: 'norm', title: 'x', content: { ...NORM, numero_articolo: 1453 } } });
      expect((await text(numbered.id)).status).toBe(200);
    });

    it('cuts a long text in pages at a line end', async () => {
      const long = Array.from({ length: 3000 }, (_, i) => `Riga ${i}: il testo continua con altre parole.`).join('\n');
      nock.cleanAll();
      nock(API).post('/fetch_article_text').times(10).reply(() => [200, [{ article_text: long, norma_data: NORM, validity }]]);
      const first = await text();
      expect(first.body.parti).toBeGreaterThan(1);
      expect(first.body.testo.length).toBeLessThanOrEqual(20_000);
      expect(first.body.testo.endsWith('\n')).toBe(true);
      const all: string[] = [];
      for (let parte = 1; parte <= first.body.parti; parte++) all.push((await text(normId, `?parte=${parte}`)).body.testo);
      expect(all.join('')).toBe(long);
      expect((await text(normId, `?parte=${first.body.parti + 1}`)).status).toBe(400);
    });
  });

  describe('POST …/passages, gone', () => {
    it('answers 410 in words, whatever it is sent, reads no text and stores nothing; the saved ones stay', async () => {
      const saved = await savedMark(alice.id, normId, 'il risarcimento del danno', 10, { note: 'Vecchia.' });
      for (const body of [{ passaggi: [{ testo: 'il risarcimento del danno', colore: 'verde' }] }, { passaggi: [{ testo: 'x', colore: 'rosso' }] }, {}]) {
        const response = await request(app).post(`/api/dossiers/${dossierId}/items/${normId}/passages`).set(as()).send(body);
        expect(response.status).toBe(410);
        expect(response.body.detail).toBe('Le evidenziazioni proposte dall’IA non ci sono più: evidenziare è un gesto dell’utente. Per spiegare un passaggio proponi una glossa.');
      }
      // Also with the switches off, and for the user's session.
      await switchOn(false);
      expect((await request(app).post(`/api/dossiers/${dossierId}/items/${normId}/passages`).set(authHeader(alice)).send({ passaggi: [] })).status).toBe(410);
      expect(articleBodies).toEqual([]);
      expect(await prisma.highlight.findMany()).toEqual([saved]);
    });

    it('costs nothing', async () => {
      const before = await delegatedQuotaStatus(alice.id);
      await request(app).post(`/api/dossiers/${dossierId}/items/${normId}/passages`).set(as()).send({ passaggi: [{ testo: 'il risarcimento del danno' }] });
      await new Promise((r) => setTimeout(r, 50));
      const after = await delegatedQuotaStatus(alice.id);
      expect(after.points.remaining).toBe(before.points.remaining);
      expect(after.counters.passage.remaining).toBe(before.counters.passage.remaining);
    });
  });

  describe('POST …/glosses', () => {
    it('stores what it finds, as the text’s own slice, under the reader’s key, with no colour, one outcome per gloss', async () => {
      const response = await gloss([
        { testo: 'la risoluzione\ndel contratto,   salvo', nota: '  Il rimedio.  ' },
        { testo: 'non compare in questo testo', nota: 'x' },
        { testo: 'breve', nota: 'x' },
      ]);
      expect(response.status).toBe(400); // «breve» is under 15 characters: the call is malformed
      const ok = await gloss([
        { testo: 'la risoluzione\ndel contratto,   salvo', nota: '  Il rimedio.  ' },
        { testo: 'non compare in questo testo affatto', nota: 'x' },
        // Fifteen characters, but only eight of them words.
        { testo: 'a b c d e f g h', nota: 'x' },
      ]);
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({
        voce: { id: normId, riferimento: 'art. 1453 c.c.' },
        glosse: [
          { esito: 'proposta', id: expect.any(String) },
          { esito: 'rifiutata', motivo: 'non trovato alla lettera nel testo' },
          { esito: 'rifiutata', motivo: 'troppo corto' },
        ],
      });
      const row = await prisma.highlight.findUniqueOrThrow({ where: { id: ok.body.glosse[0].id } });
      const projection = RAW.replace(/\n/g, '');
      expect(row).toMatchObject({
        userId: alice.id,
        kind: 'gloss',
        color: null,
        normaKey: KEY,
        text: 'la risoluzione del contratto, salvo',
        note: 'Il rimedio.',
        assistantNote: 'Il rimedio.',
        noteState: 'proposed',
        createdByClientName: 'Claude Code',
        dossierItemId: normId,
        assistantText: 'la risoluzione del contratto, salvo',
      });
      expect(projection.slice(row.startOffset, row.endOffset)).toBe(row.text);
      expect(row.assistantStartOffset).toBe(row.startOffset);
    });

    /** The source answers this text for the article. */
    const serve = (article_text: string) => {
      nock.cleanAll();
      nock(API).post('/fetch_article_text').times(50).reply(() => [200, [{ article_text, norma_data: NORM, validity }]]);
    };

    it('chooses among repeated words with «prima» or «dopo», and gives the count otherwise', async () => {
      serve(`${RAW}\n\n Ancora: il risarcimento del danno è dovuto.`);
      const response = await gloss([
        { testo: 'il risarcimento del danno', nota: 'a' },
        { testo: 'il risarcimento del danno', nota: 'b', dopo: 'è dovuto' },
        { testo: 'il risarcimento del danno', nota: 'c', prima: 'in ogni caso,' },
        { testo: 'il risarcimento del danno', nota: 'd', prima: 'nessuna di queste parole' },
      ]);
      const [counted, after, before, wrong] = response.body.glosse;
      expect(counted).toEqual({ esito: 'rifiutata', motivo: 'compare 2 volte: aggiungi "prima" o "dopo"' });
      expect(wrong).toEqual(counted);
      const rows = await prisma.highlight.findMany({ where: { id: { in: [after.id, before.id] } } });
      const projection = `${RAW}\n\n Ancora: il risarcimento del danno è dovuto.`.replace(/\n/g, '');
      expect(rows.map((r) => r.startOffset).sort((a, b) => a - b)).toEqual([
        projection.indexOf('il risarcimento del danno'),
        projection.lastIndexOf('il risarcimento del danno'),
      ]);
    });

    it('refuses a gloss in the same place twice, beside the user’s own marks and a saved coloured passage, unread', async () => {
      const at = RAW.replace(/\n/g, '').indexOf('il risarcimento del danno');
      // The user marked the same words, and an application proposed them in colour before D8: the model is never
      // told, and its gloss is stored beside them.
      await request(app).post('/api/highlights').set(authHeader(alice)).send({ normaKey: KEY, text: 'il risarcimento del danno', color: 'red', startOffset: at, endOffset: at + 25 });
      await savedMark(alice.id, normId, 'il risarcimento del danno', at, { clientId: 'irrelevant' });
      const first = await gloss([{ testo: 'il risarcimento del danno', nota: 'a' }, { testo: 'il risarcimento del danno', nota: 'b' }]);
      expect(first.body.glosse.map((p: { esito: string; motivo?: string }) => p.motivo ?? p.esito)).toEqual(['proposta', 'già glossato in questo punto']);
    });

    it('judges a repeat by where the model put a gloss, never by where the user moved it', async () => {
      const first = await gloss([{ testo: 'il risarcimento del danno', nota: 'a' }]);
      const projection = RAW.replace(/\n/g, '');
      const moved = projection.indexOf('la risoluzione del contratto');
      await prisma.highlight.update({ where: { id: first.body.glosse[0].id }, data: { startOffset: moved, text: 'la risoluzione del contratto', endOffset: moved + 28 } });
      const again = await gloss([{ testo: 'il risarcimento del danno', nota: 'a' }, { testo: 'la risoluzione del contratto', nota: 'b' }]);
      expect(again.body.glosse.map((p: { esito: string; motivo?: string }) => p.motivo ?? p.esito)).toEqual(['già glossato in questo punto', 'proposta']);
    });

    it('glosses a decision, in its projection, under its key with no article', async () => {
      const response = await gloss([{ testo: 'la violazione dell’art. 640 c.p.', nota: 'Il motivo.' }], decisionId);
      expect(response.body.glosse[0].esito).toBe('proposta');
      const row = await prisma.highlight.findUniqueOrThrow({ where: { id: response.body.glosse[0].id } });
      expect(row.normaKey).toBe('cassazione:penale:10787:2024::art::');
      const projection = ['REPUBBLICA ITALIANA\nLA CORTE SUPREMA DI CASSAZIONE', DECISION_TEXT.motivazione, DECISION_TEXT.dispositivo].join('').replace(/\n/g, '');
      expect(projection.slice(row.startOffset, row.endOffset)).toBe('la violazionedell’art. 640 c.p.');
    });

    it('refuses the whole call on a note, a text not in force, a source down, the switch off', async () => {
      const one = [{ testo: 'il risarcimento del danno', nota: 'a' }];
      expect((await gloss(one, noteId)).status).toBe(400);
      validity = { state: 'historical' };
      const past = await gloss(one);
      expect(past.status).toBe(400);
      expect(past.body.detail).toBe('Questa voce mostra un testo non in vigore: le glosse non si vedrebbero.');
      validity = undefined;
      articleStatus = 500;
      expect((await gloss(one)).status).toBe(503);
      articleStatus = 200;
      await switchOn(false);
      // The passages' switch alone does not open it.
      await switchOn(true, 'assistant_passages');
      const off = await gloss(one);
      expect(off.status).toBe(404);
      expect(off.body.detail).toBe('Non disponibile');
      expect(await prisma.highlight.count()).toBe(0);
    });

    it('needs dossier:write and dossier:text, an application, and the user’s own dossier', async () => {
      const one = [{ testo: 'il risarcimento del danno', nota: 'a' }];
      const writeOnly = (await delegatedToken(alice, 'dossier:read dossier:write')).apiToken;
      const textOnly = (await delegatedToken(alice, 'dossier:read dossier:text')).apiToken;
      expect((await gloss(one, normId, { Authorization: `Bearer ${writeOnly}` })).status).toBe(403);
      expect((await gloss(one, normId, { Authorization: `Bearer ${textOnly}` })).status).toBe(403);
      expect((await gloss(one, normId, authHeader(alice))).status).toBe(403);
      const bob = await createTestUser('glosses-bob');
      const bobToken = (await delegatedToken(bob, 'dossier:read dossier:write dossier:text')).apiToken;
      expect((await gloss(one, normId, { Authorization: `Bearer ${bobToken}` })).status).toBe(404);
      expect(await prisma.highlight.count()).toBe(0);
    });

    it('refuses more than ten glosses, none, a missing or empty note, a long one, unknown keys, a colour, a long context, control characters', async () => {
      const ok = { testo: 'il risarcimento del danno', nota: 'a' };
      expect((await gloss(Array.from({ length: 11 }, () => ok))).status).toBe(400);
      expect((await gloss([])).status).toBe(400);
      expect((await gloss([{ testo: ok.testo }])).status).toBe(400);
      expect((await gloss([{ ...ok, nota: '   ' }])).status).toBe(400);
      expect((await gloss([{ ...ok, nota: 'a'.repeat(1501) }])).status).toBe(400);
      expect((await gloss([{ ...ok, pagina: 1 }])).status).toBe(400);
      expect((await gloss([{ ...ok, colore: 'giallo' }])).status).toBe(400);
      expect((await gloss([{ ...ok, prima: 'a'.repeat(201) }])).status).toBe(400);
      expect((await gloss([{ ...ok, nota: 'a\u0007b' }])).status).toBe(400);
      expect(await prisma.highlight.count()).toBe(0);
      // Exactly 1500, counted as the server counts (UTF-16 units).
      expect((await gloss([{ ...ok, nota: 'a'.repeat(1500) }])).body.glosse[0].esito).toBe('proposta');
    });

    it('charges two points and one passage each, and gives back the refused ones', async () => {
      const before = await delegatedQuotaStatus(alice.id);
      await gloss([
        { testo: 'il risarcimento del danno', nota: 'a' },
        { testo: 'non compare in questo testo affatto', nota: 'b' },
        { testo: 'non compare neanche questo testo', nota: 'c' },
      ]);
      // The refund runs when the answer is sent.
      await new Promise((r) => setTimeout(r, 50));
      const after = await delegatedQuotaStatus(alice.id);
      expect(before.points.remaining - after.points.remaining).toBe(2);
      expect(before.counters.passage.remaining - after.counters.passage.remaining).toBe(1);
      expect(after.counters.passage.limit).toBe(100);
    });

    it('stops at thirty open proposals on an entry, saved marks included, under four calls at once', async () => {
      const sentences = Array.from({ length: 40 }, (_, n) => `Frase numero ${String(n).padStart(2, '0')} del testo di prova.`);
      serve(sentences.join('\n'));
      // Two coloured passages saved before D8, one with no note (open for good until removed) and one validated.
      await savedMark(alice.id, normId, 'Frase numero 39', 0);
      await savedMark(alice.id, normId, 'Frase numero 38', 0, { note: 'n' }).then((h) => prisma.highlight.update({ where: { id: h.id }, data: { noteState: 'validated' } }));
      const calls = [0, 1, 2, 3].map((k) => sentences.slice(k * 10, k * 10 + 10).map((testo) => ({ testo, nota: 'n' })));
      const answers = await Promise.all(calls.map((glosse) => gloss(glosse)));
      const outcomes = answers.flatMap((a) => a.body.glosse as { esito: string; motivo?: string }[]);
      expect(outcomes.filter((o) => o.esito === 'proposta')).toHaveLength(29);
      expect(outcomes.filter((o) => o.motivo === 'limite di proposte aperte su questa voce raggiunto')).toHaveLength(11);
      expect(await prisma.highlight.count({ where: { dossierItemId: normId, kind: 'gloss' } })).toBe(29);
      // A validated gloss no longer counts as open.
      await prisma.highlight.updateMany({ where: { dossierItemId: normId, kind: 'gloss' }, data: { noteState: 'validated' } });
      const stored = new Set((await prisma.highlight.findMany({ where: { dossierItemId: normId, kind: 'gloss' }, select: { text: true } })).map((h) => h.text));
      const left = sentences.find((sentence) => !stored.has(sentence))!;
      expect((await gloss([{ testo: left, nota: 'n' }])).body.glosse[0].esito).toBe('proposta');
    });
  });

  describe('the table', () => {
    it('keeps a gloss without a colour and with a note, and a mark with a colour', async () => {
      const base = {
        userId: alice.id, normaKey: KEY, text: 'il risarcimento del danno', startOffset: 10, endOffset: 35,
        createdByClientId: 'c', dossierItemId: normId, assistantText: 'il risarcimento del danno', assistantStartOffset: 10,
      };
      // A gloss with a colour, or with no note, no state, an empty note, or none from an application.
      await expect(prisma.highlight.create({ data: { ...base, kind: 'gloss', color: 'yellow', note: 'n', assistantNote: 'n', noteState: 'proposed' } })).rejects.toThrow();
      await expect(prisma.highlight.create({ data: { ...base, kind: 'gloss', color: null } })).rejects.toThrow();
      await expect(prisma.highlight.create({ data: { ...base, kind: 'gloss', color: null, note: ' ', assistantNote: 'n', noteState: 'proposed' } })).rejects.toThrow();
      await expect(
        prisma.highlight.create({ data: { userId: alice.id, normaKey: KEY, text: 'x', startOffset: 0, endOffset: 1, kind: 'gloss', color: null, note: 'n' } }),
      ).rejects.toThrow();
      // A mark with no colour.
      await expect(prisma.highlight.create({ data: { userId: alice.id, normaKey: KEY, text: 'x', startOffset: 0, endOffset: 1, color: null } })).rejects.toThrow();
      // A highlight of the user's own is a mark, yellow unless said.
      const own = await prisma.highlight.create({ data: { userId: alice.id, normaKey: KEY, text: 'x', startOffset: 0, endOffset: 1 } });
      expect(own).toMatchObject({ kind: 'mark', color: 'yellow' });
      expect(await prisma.highlight.count()).toBe(1);
    });
  });
});
