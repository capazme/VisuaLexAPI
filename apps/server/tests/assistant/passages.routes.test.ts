import nock from 'nock';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from '../helpers';
import { delegatedToken } from '../oauth/oauthHelpers';
import { delegatedQuotaStatus } from '../../src/middleware/delegated';
import { ARTICLE_FIXTURES } from '../../../web/src/utils/__fixtures__/articleTexts';

// D7b, the connected application's side (spec §8.4, §8.7): an entry's text, and passages proposed on it,
// found in the text the reader reads, stored as the assistant's marks.

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

async function switchOn(enabled = true) {
  await prisma.appSwitch.upsert({ where: { key: 'assistant_passages' }, create: { key: 'assistant_passages', enabled }, update: { enabled } });
}

describe('D7b — an entry’s text and the passages proposed on it', () => {
  let alice: TestUser;
  let dossierId: string;
  let normId: string;
  let decisionId: string;
  let noteId: string;
  let token: string;
  const as = () => ({ Authorization: `Bearer ${token}` });
  const text = (itemId = normId, query = '') => request(app).get(`/api/dossiers/${dossierId}/items/${itemId}/text${query}`).set(as());
  const propose = (passaggi: unknown, itemId = normId, who = as()) =>
    request(app).post(`/api/dossiers/${dossierId}/items/${itemId}/passages`).set(who).send({ passaggi });

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
        proposte: [],
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

    it('refuses a note, a source that cannot answer, another user’s dossier, and the switch off', async () => {
      expect((await text(noteId)).body.detail).toBe('Questa voce non ha un testo: è una nota.');
      articleStatus = 502;
      expect((await text()).status).toBe(503);
      const bob = await createTestUser('passages-bob');
      const bobToken = (await delegatedToken(bob, 'dossier:read dossier:text')).apiToken;
      expect((await request(app).get(`/api/dossiers/${dossierId}/items/${normId}/text`).set({ Authorization: `Bearer ${bobToken}` })).status).toBe(404);
      await switchOn(false);
      articleStatus = 200;
      expect((await text()).status).toBe(404);
    });

    it('needs dossier:text', async () => {
      const without = (await delegatedToken(alice, 'dossier:read dossier:write')).apiToken;
      const response = await request(app).get(`/api/dossiers/${dossierId}/items/${normId}/text`).set({ Authorization: `Bearer ${without}` });
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('insufficient_scope');
    });

    it('lists only the assistant’s proposals the user has not taken up, as the model wrote them', async () => {
      await propose([
        { testo: 'il risarcimento del danno', nota: 'Danno.' },
        { testo: 'la risoluzione del contratto', colore: 'verde' },
        { testo: "Dalla data della domanda di risoluzione l'inadempiente", nota: 'Termine.' },
      ]);
      const rows = await prisma.highlight.findMany({ where: { dossierItemId: normId }, orderBy: { startOffset: 'asc' } });
      // The user validates one note, and moves the boundaries of the bare mark.
      await prisma.highlight.update({ where: { id: rows[2].id }, data: { noteState: 'validated' } });
      await prisma.highlight.update({ where: { id: rows[0].id }, data: { startOffset: 1, text: 'x' } });
      // A highlight of the user's own is never listed.
      await request(app).post('/api/highlights').set(authHeader(alice)).send({ normaKey: KEY, text: 'contratti', color: 'red', startOffset: 50, endOffset: 59 });
      const response = await text();
      expect(response.body.proposte).toEqual([
        { testo: 'la risoluzione del contratto', colore: 'verde', nota: null },
        { testo: 'il risarcimento del danno', colore: 'giallo', nota: 'Danno.' },
      ]);
    });

    it('lists another application’s proposals to no one but it, and reads nothing for a session', async () => {
      await propose([{ testo: 'il risarcimento del danno', nota: 'Fatti della pratica.' }]);
      const other = (await delegatedToken(alice, 'dossier:read dossier:write dossier:text')).apiToken;
      const seen = await request(app).get(`/api/dossiers/${dossierId}/items/${normId}/text`).set({ Authorization: `Bearer ${other}` });
      expect(seen.body.proposte).toEqual([]);
      expect((await text()).body.proposte).toHaveLength(1);
      const session = await request(app).get(`/api/dossiers/${dossierId}/items/${normId}/text`).set(authHeader(alice));
      expect(session.status).toBe(403);
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

  describe('POST …/passages', () => {
    it('stores what it finds, as the text’s own slice, under the reader’s key, one outcome per passage', async () => {
      const response = await propose([
        { testo: 'la risoluzione\ndel contratto,   salvo', colore: 'blu', nota: '  Il rimedio.  ' },
        { testo: 'non compare in questo testo' },
        { testo: 'breve' },
      ]);
      expect(response.status).toBe(400); // «breve» is under 15 characters: the call is malformed
      const ok = await propose([
        { testo: 'la risoluzione\ndel contratto,   salvo', colore: 'blu', nota: '  Il rimedio.  ' },
        { testo: 'non compare in questo testo affatto' },
        // Fifteen characters, but only eight of them words.
        { testo: 'a b c d e f g h' },
      ]);
      expect(ok.status).toBe(200);
      expect(ok.body.passaggi).toEqual([
        { esito: 'proposto', id: expect.any(String), colore: 'blu', nota: true },
        { esito: 'rifiutato', motivo: 'non trovato alla lettera nel testo' },
        { esito: 'rifiutato', motivo: 'troppo corto' },
      ]);
      const row = await prisma.highlight.findUniqueOrThrow({ where: { id: ok.body.passaggi[0].id } });
      const projection = RAW.replace(/\n/g, '');
      expect(row).toMatchObject({
        userId: alice.id,
        normaKey: KEY,
        text: 'la risoluzione del contratto, salvo',
        color: 'blue',
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
      const response = await propose([
        { testo: 'il risarcimento del danno' },
        { testo: 'il risarcimento del danno', dopo: 'è dovuto' },
        { testo: 'il risarcimento del danno', prima: 'in ogni caso,' },
        { testo: 'il risarcimento del danno', prima: 'nessuna di queste parole' },
      ]);
      const [counted, after, before, wrong] = response.body.passaggi;
      expect(counted).toEqual({ esito: 'rifiutato', motivo: 'compare 2 volte: aggiungi "prima" o "dopo"' });
      expect(wrong).toEqual(counted);
      const rows = await prisma.highlight.findMany({ where: { id: { in: [after.id, before.id] } } });
      const projection = `${RAW}\n\n Ancora: il risarcimento del danno è dovuto.`.replace(/\n/g, '');
      expect(rows.map((r) => r.startOffset).sort((a, b) => a - b)).toEqual([
        projection.indexOf('il risarcimento del danno'),
        projection.lastIndexOf('il risarcimento del danno'),
      ]);
    });

    it('refuses the same words in the same place twice, and leaves the user’s own marks unread', async () => {
      const at = RAW.replace(/\n/g, '').indexOf('il risarcimento del danno');
      // The user marked the same words: the model is never told, and its proposal is stored beside it.
      await request(app).post('/api/highlights').set(authHeader(alice)).send({ normaKey: KEY, text: 'il risarcimento del danno', color: 'red', startOffset: at, endOffset: at + 25 });
      const first = await propose([{ testo: 'il risarcimento del danno' }, { testo: 'il risarcimento del danno' }]);
      expect(first.body.passaggi.map((p: { esito: string; motivo?: string }) => p.motivo ?? p.esito)).toEqual(['proposto', 'già proposto in questo punto']);
    });

    it('judges a repeat by where the model put a mark, never by where the user moved it', async () => {
      const first = await propose([{ testo: 'il risarcimento del danno' }]);
      const projection = RAW.replace(/\n/g, '');
      const moved = projection.indexOf('la risoluzione del contratto');
      await prisma.highlight.update({ where: { id: first.body.passaggi[0].id }, data: { startOffset: moved, text: 'la risoluzione del contratto', endOffset: moved + 28 } });
      const again = await propose([{ testo: 'il risarcimento del danno' }, { testo: 'la risoluzione del contratto' }]);
      expect(again.body.passaggi.map((p: { esito: string; motivo?: string }) => p.motivo ?? p.esito)).toEqual(['già proposto in questo punto', 'proposto']);
    });

    it('proposes on a decision, in its projection, under its key with no article', async () => {
      const response = await propose([{ testo: 'la violazione dell’art. 640 c.p.', nota: 'Il motivo.' }], decisionId);
      expect(response.body.passaggi[0].esito).toBe('proposto');
      const row = await prisma.highlight.findUniqueOrThrow({ where: { id: response.body.passaggi[0].id } });
      expect(row.normaKey).toBe('cassazione:penale:10787:2024::art::');
      const projection = ['REPUBBLICA ITALIANA\nLA CORTE SUPREMA DI CASSAZIONE', DECISION_TEXT.motivazione, DECISION_TEXT.dispositivo].join('').replace(/\n/g, '');
      expect(projection.slice(row.startOffset, row.endOffset)).toBe('la violazionedell’art. 640 c.p.');
    });

    it('refuses the whole call on a note, a text not in force, a source down, the switch off', async () => {
      expect((await propose([{ testo: 'il risarcimento del danno' }], noteId)).status).toBe(400);
      validity = { state: 'historical' };
      const past = await propose([{ testo: 'il risarcimento del danno' }]);
      expect(past.status).toBe(400);
      expect(past.body.detail).toBe('Questa voce mostra un testo non in vigore: le evidenziazioni non si vedrebbero.');
      validity = undefined;
      articleStatus = 500;
      expect((await propose([{ testo: 'il risarcimento del danno' }])).status).toBe(503);
      articleStatus = 200;
      await switchOn(false);
      expect((await propose([{ testo: 'il risarcimento del danno' }])).status).toBe(404);
      expect(await prisma.highlight.count()).toBe(0);
    });

    it('needs dossier:write and dossier:text, and an application', async () => {
      const writeOnly = (await delegatedToken(alice, 'dossier:read dossier:write')).apiToken;
      const textOnly = (await delegatedToken(alice, 'dossier:read dossier:text')).apiToken;
      expect((await propose([{ testo: 'il risarcimento del danno' }], normId, { Authorization: `Bearer ${writeOnly}` })).status).toBe(403);
      expect((await propose([{ testo: 'il risarcimento del danno' }], normId, { Authorization: `Bearer ${textOnly}` })).status).toBe(403);
      expect((await propose([{ testo: 'il risarcimento del danno' }], normId, authHeader(alice))).status).toBe(403);
    });

    it('refuses more than ten passages, unknown keys, a long context, a note with control characters', async () => {
      const ten = Array.from({ length: 11 }, () => ({ testo: 'il risarcimento del danno' }));
      expect((await propose(ten)).status).toBe(400);
      expect((await propose([{ testo: 'il risarcimento del danno', pagina: 1 }])).status).toBe(400);
      expect((await propose([{ testo: 'il risarcimento del danno', prima: 'a'.repeat(201) }])).status).toBe(400);
      expect((await propose([{ testo: 'il risarcimento del danno', nota: 'a\u0007b' }])).status).toBe(400);
      expect((await propose([{ testo: 'il risarcimento del danno', colore: 'viola' }])).status).toBe(400);
      expect(await prisma.highlight.count()).toBe(0);
    });

    it('refuses red, the sign of a note «da rivedere», in words, and keeps the three colours the assistant chooses', async () => {
      const red = await propose([{ testo: 'il risarcimento del danno' }, { testo: 'la risoluzione del contratto', colore: 'rosso' }]);
      expect(red.status).toBe(400);
      expect(red.body.detail).toBe('Il rosso non si sceglie: è il segno di una nota «da rivedere». Usa giallo (punto centrale), verde (condizione o presupposto) o blu (definizione o eccezione).');
      expect(await prisma.highlight.count()).toBe(0);
      expect((await propose([{ testo: 'il risarcimento del danno', colore: ' Rosso ' }])).body.detail).toMatch(/^Il rosso non si sceglie/);
      const ok = await propose([
        { testo: 'il risarcimento del danno', colore: 'giallo' },
        { testo: 'la risoluzione del contratto', colore: 'verde' },
        { testo: "Dalla data della domanda di risoluzione l'inadempiente", colore: 'blu' },
      ]);
      expect(ok.body.passaggi.map((p: { colore: string }) => p.colore)).toEqual(['giallo', 'verde', 'blu']);
      const stored = await prisma.highlight.findMany({ orderBy: { startOffset: 'asc' }, select: { color: true } });
      expect(stored.map((h) => h.color).sort()).toEqual(['blue', 'green', 'yellow']);
    });

    it('charges two points and one passage each, and gives back the refused ones', async () => {
      const before = await delegatedQuotaStatus(alice.id);
      await propose([{ testo: 'il risarcimento del danno' }, { testo: 'non compare in questo testo affatto' }, { testo: 'non compare neanche questo testo' }]);
      // The refund runs when the answer is sent.
      await new Promise((r) => setTimeout(r, 50));
      const after = await delegatedQuotaStatus(alice.id);
      expect(before.points.remaining - after.points.remaining).toBe(2);
      expect(before.counters.passage.remaining - after.counters.passage.remaining).toBe(1);
      expect(after.counters.passage.limit).toBe(100);
    });

    it('stops at thirty open proposals on an entry, under four calls at once', async () => {
      const sentences = Array.from({ length: 40 }, (_, n) => `Frase numero ${String(n).padStart(2, '0')} del testo di prova.`);
      serve(sentences.join('\n'));
      const calls = [0, 1, 2, 3].map((k) => sentences.slice(k * 10, k * 10 + 10).map((testo) => ({ testo })));
      const answers = await Promise.all(calls.map((passaggi) => propose(passaggi)));
      const outcomes = answers.flatMap((a) => a.body.passaggi as { esito: string; motivo?: string }[]);
      expect(outcomes.filter((o) => o.esito === 'proposto')).toHaveLength(30);
      expect(outcomes.filter((o) => o.motivo === 'limite di proposte aperte su questa voce raggiunto')).toHaveLength(10);
      expect(await prisma.highlight.count({ where: { dossierItemId: normId } })).toBe(30);
      // A validated note no longer counts as open.
      await prisma.highlight.updateMany({ where: { dossierItemId: normId }, data: { note: 'n', assistantNote: 'n', noteState: 'validated' } });
      const stored = new Set((await prisma.highlight.findMany({ where: { dossierItemId: normId }, select: { text: true } })).map((h) => h.text));
      const left = sentences.find((sentence) => !stored.has(sentence))!;
      expect((await propose([{ testo: left }])).body.passaggi[0].esito).toBe('proposto');
    });
  });
});
