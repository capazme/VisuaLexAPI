import nock from 'nock';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { anchorKeys, anchorUrn, fingerprintFor } from '../src/lingo/anchors';
import type { NormaVisitata } from '../src/norms/resolveReference';

// The anchors of a study card (MCP second round, spec §6; owner's answers S6 and
// S7): normaKey and articleId are labels derived in one place, the official URN
// is the identity, and an article in an annex takes its fingerprint from the AKN
// part matched to that annex through the tree's article numbers.

const API = 'http://legal-api.test';
const originalLegalApiUrl = process.env.LEGAL_API_URL;
const CC = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262';
const LAW = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241';
const DLGS = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2003-06-30;196';

const norm = (over: Partial<NormaVisitata>): NormaVisitata => ({
  tipo_atto: 'codice civile',
  tipo_atto_reale: 'regio decreto',
  data: '1942-03-16',
  numero_atto: '262',
  numero_articolo: '1453',
  allegato: '2',
  url: CC,
  urn: `${CC}:2~art1453`,
  ...over,
});

const fp = (c: string) => ({ fingerprint: c.repeat(64), date: null });

describe('anchorKeys', () => {
  it.each([
    ['a code', norm({}), { normaKey: 'codice_civile', articleId: 'art_1453', urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453' }],
    ['the preleggi', norm({ tipo_atto: 'preleggi', numero_articolo: '12', allegato: '1', urn: `${CC}:1~art12` }), { normaKey: 'preleggi', articleId: 'art_12' }],
    ['a law, with a suffix', norm({ tipo_atto: 'legge', tipo_atto_reale: null, data: '1990-08-07', numero_atto: '241', numero_articolo: '2-bis', allegato: null, url: LAW, urn: `${LAW}~art2bis` }),
      { normaKey: 'legge_1990_08_07_241', articleId: 'art_2_bis', urn: 'urn:nir:stato:legge:1990-08-07;241~art2bis' }],
    ['an article in an annex of an ordinary act', norm({ tipo_atto: 'decreto legislativo', tipo_atto_reale: null, data: '2003-06-30', numero_atto: '196', numero_articolo: '3', allegato: '1', url: DLGS, urn: `${DLGS}:1~art3` }),
      { normaKey: 'decreto_legislativo_2003_06_30_196', articleId: 'all_1_art_3' }],
    ['the Constitution', norm({ tipo_atto: 'costituzione', tipo_atto_reale: null, data: '1947-12-27', numero_atto: null, numero_articolo: '81', allegato: null, url: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:costituzione:1947-12-27', urn: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:costituzione:1947-12-27~art81' }),
      { normaKey: 'costituzione', articleId: 'art_81' }],
  ])('%s', (_label, input, expected) => {
    const keys = anchorKeys(input);
    expect(keys).toMatchObject(expected);
    expect(keys!.normaKey).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
  });

  it('gives no anchor for a norm without an official URN (an EU act)', () => {
    expect(anchorKeys(norm({ tipo_atto: 'regolamento UE', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita', urn: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita~art5' }))).toBeNull();
  });
});

describe('anchorUrn', () => {
  it.each([
    ['the c.c. address with an article', `${CC}:2~art1453`, 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453'],
    ['the same address with the version the reader adds', `${CC}:2~art1453!vig=2026-10-07`, 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453'],
    ['an original-text suffix', `${LAW}~art2bis@originale`, 'urn:nir:stato:legge:1990-08-07;241~art2bis'],
    ['an address that is already the URN', 'urn:nir:stato:legge:1990-08-07;241~art2bis', 'urn:nir:stato:legge:1990-08-07;241~art2bis'],
  ])('%s', (_label, raw, expected) => {
    expect(anchorUrn(raw)).toBe(expected);
  });

  it('is null for an EUR-Lex address or an empty string', () => {
    expect(anchorUrn('https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita~art5')).toBeNull();
    expect(anchorUrn('')).toBeNull();
  });

  it('agrees with the cut anchorKeys stores', () => {
    const stored = anchorKeys(norm({ urn: `${CC}:2~art1453!vig=2026-10-07` }));
    expect(stored!.urn).toBe(anchorUrn(`${CC}:2~art1453`));
  });
});

describe('fingerprintFor', () => {
  let fingerprints: Record<string, unknown>;
  let tree: unknown;
  beforeAll(() => nock.activate());
  afterAll(() => nock.restore());
  beforeEach(() => {
    process.env.LEGAL_API_URL = API;
    tree = undefined;
    nock(API).post('/fetch_act_fingerprints').times(20).reply(() => [200, fingerprints]);
    nock(API).post('/fetch_tree').times(20).reply(() => (tree ? [200, tree] : [500, { error: 'down' }]));
  });
  afterEach(() => {
    nock.cleanAll();
    if (originalLegalApiUrl === undefined) delete process.env.LEGAL_API_URL;
    else process.env.LEGAL_API_URL = originalLegalApiUrl;
  });

  it('takes a single-part act\'s fingerprint by the article number', async () => {
    fingerprints = { available: true, fingerprints: { '1': fp('1'), '2-bis': fp('2') }, parts: [], count: 2 };
    const result = await fingerprintFor(norm({ tipo_atto: 'legge', tipo_atto_reale: null, numero_articolo: '2-bis', allegato: null, url: LAW, urn: `${LAW}~art2bis` }));
    expect(result).toEqual({ fingerprint: '2'.repeat(64) });
  });

  it('takes an annexed article\'s fingerprint from the part whose article numbers match the annex (S7)', async () => {
    fingerprints = {
      available: true,
      fingerprints: { '1': fp('a'), '1453': fp('d') },
      parts: [
        { name: 'Disposizioni sulla legge in generale', fingerprints: { '1': fp('f'), '12': fp('b') } },
        { name: 'CODICE CIVILE', fingerprints: { '1': fp('a'), '1453': fp('c'), '1454': fp('e') } },
      ],
      count: 3,
    };
    tree = { articles: [{ allegato: '1', numero: '1' }, { allegato: '1', numero: '12' }, { allegato: '2', numero: '1' }, { allegato: '2', numero: '1453' }, { allegato: '2', numero: '1454' }] };
    expect(await fingerprintFor(norm({}))).toEqual({ fingerprint: 'c'.repeat(64) });
    expect(await fingerprintFor(norm({ tipo_atto: 'preleggi', numero_articolo: '12', allegato: '1', urn: `${CC}:1~art12` }))).toEqual({ fingerprint: 'b'.repeat(64) });
  });

  it('refuses when two parts match the annex equally (S7: never another part\'s fingerprint)', async () => {
    fingerprints = {
      available: true,
      fingerprints: {},
      parts: [
        { name: 'A', fingerprints: { '1': fp('a'), '2': fp('b') } },
        { name: 'B', fingerprints: { '1': fp('c'), '2': fp('d') } },
      ],
      count: 4,
    };
    tree = { articles: [{ allegato: '2', numero: '1' }, { allegato: '2', numero: '2' }] };
    const result = await fingerprintFor(norm({ numero_articolo: '1' }));
    expect(result).toEqual({ unavailable: 'Non riesco a verificare l’articolo nell’allegato: la scheda non può essere ancorata.', transient: false });
  });

  it('refuses without the act\'s index, or without its tree when the act is in parts', async () => {
    fingerprints = { available: false, fingerprints: {}, parts: [], count: 0 };
    expect(await fingerprintFor(norm({}))).toHaveProperty('unavailable');
    fingerprints = { available: true, fingerprints: {}, parts: [{ name: 'A', fingerprints: {} }, { name: 'B', fingerprints: {} }], count: 0 };
    expect(await fingerprintFor(norm({}))).toHaveProperty('unavailable');
  });

  it('refuses an article of an annex when the act\'s index has no parts to match it to (code review of PR 5, CR4)', async () => {
    fingerprints = { available: true, fingerprints: { '3': fp('a') }, parts: [], count: 1 };
    tree = { articles: [{ allegato: '', numero: '3' }, { allegato: '1', numero: '3' }] };
    const result = await fingerprintFor(norm({ tipo_atto: 'decreto legislativo', tipo_atto_reale: null, numero_articolo: '3', allegato: '1', url: DLGS, urn: `${DLGS}:1~art3` }));
    expect(result).toEqual({ unavailable: 'Non riesco a verificare l’articolo nell’allegato: la scheda non può essere ancorata.', transient: false });
  });

  it('refuses an EU act: there is no AKN index', async () => {
    const result = await fingerprintFor(norm({ tipo_atto: 'regolamento UE', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita', urn: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita~art5' }));
    expect(result).toEqual({ unavailable: 'Per gli atti dell’Unione europea non c’è un’impronta del testo: la scheda non può essere ancorata.', transient: false });
  });
});
