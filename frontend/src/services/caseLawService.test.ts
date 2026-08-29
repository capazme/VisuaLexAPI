import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildCaseLawReference, clearCaseLawCache, fetchCaseLawCached, isUnsearchableActType } from './caseLawService';

describe('buildCaseLawReference', () => {
  it('abbreviates a codified act to the form courts actually cite', () => {
    // The flagship example throughout the backend's own docs and tests
    // (visualex_api/services/case_law/italgiure.py) — "art. 2043 codice
    // civile" would never match a decision's OCR text, which says "c.c.".
    expect(
      buildCaseLawReference({ tipo_atto: 'codice civile', numero_atto: undefined, data: '1942-03-16', numero_articolo: '2043' }),
    ).toBe('art. 2043 c.c.');
  });

  it('abbreviates the Costituzione', () => {
    expect(
      buildCaseLawReference({ tipo_atto: 'costituzione', numero_atto: undefined, data: '1947-12-27', numero_articolo: '3' }),
    ).toBe('art. 3 Cost.');
  });

  it('builds the CELLAR-shape reference for a Regolamento UE', () => {
    // Must match visualex_api/services/case_law/cellar.py's _REG regex:
    // "regolamento\s+ue\s+(?:n\.\s*)?(\d{1,4})/(\d{1,4})".
    expect(
      buildCaseLawReference({ tipo_atto: 'regolamento ue', numero_atto: '679', data: '2016-05-04', numero_articolo: '17' }),
    ).toBe('art. 17 Regolamento UE 679/2016');
  });

  it('falls back to the act name and number for an uncodified law, with the year only — never an ISO date', () => {
    // A full ISO date ("1990-08-07") never appears verbatim in a decision —
    // no court cites a day and month — so every exact-phrase source
    // (Italgiure, CeRDEF) would return nothing for it. Measured live: the
    // year-only form matches on both.
    expect(
      buildCaseLawReference({ tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', numero_articolo: '3' }),
    ).toBe('art. 3 legge n. 241 del 1990');
  });

  it('abbreviates a decreto legislativo — the spelled-out type never matches live', () => {
    // Measured against visualex_api/services/case_law/italgiure.py:
    // "decreto legislativo n. 231 del 2001" 0/10, "d.lgs. n. 231 del 2001"
    // 10/10.
    expect(
      buildCaseLawReference({ tipo_atto: 'decreto legislativo', numero_atto: '231', data: '2001-06-08', numero_articolo: '5' }),
    ).toBe('art. 5 D.lgs. n. 231 del 2001');
  });

  it('degrades to the bare act name when neither numero_atto nor data is known', () => {
    expect(
      buildCaseLawReference({ tipo_atto: 'legge', numero_atto: undefined, data: '', numero_articolo: '3' }),
    ).toBe('art. 3 legge');
  });

  it('cites a named code outside CODE_ABBREVIATIONS by its own name, never the enacting decree', () => {
    // "codice del consumo" is a NORMATTIVA_URN_CODICI alias whose real
    // enactment is a decreto legislativo — same shape as "codice civile"
    // above, but with no short abbreviation of its own. Measured live:
    // "codice del consumo n. 206 del 2005" 0/10, bare "codice del consumo"
    // 5/5 — the enacting decree's number and date must be dropped entirely,
    // not just have their date shortened to a year.
    expect(
      buildCaseLawReference({ tipo_atto: 'codice del consumo', numero_atto: '206', data: '2005-09-06', numero_articolo: '33' }),
    ).toBe('art. 33 codice del consumo');
  });
});

describe('isUnsearchableActType', () => {
  it('flags regio decreto — cited by a popular name no wire field carries', () => {
    expect(isUnsearchableActType('regio decreto')).toBe(true);
  });

  it('is case- and whitespace-tolerant, like the other tipo_atto lookups in this module', () => {
    expect(isUnsearchableActType('Regio Decreto')).toBe(true);
    expect(isUnsearchableActType('  regio decreto  ')).toBe(true);
  });

  it('does not flag ordinary act types', () => {
    expect(isUnsearchableActType('codice civile')).toBe(false);
    expect(isUnsearchableActType('legge')).toBe(false);
    expect(isUnsearchableActType('decreto legislativo')).toBe(false);
  });
});

describe('fetchCaseLawCached — session cache (same shape as utils/articleFetchCache.ts)', () => {
  beforeEach(() => {
    clearCaseLawCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serves a second call for the same riferimento from cache, without a second network request', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, statusText: 'OK', json: async () => ({ fonti: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchCaseLawCached({ riferimento: 'art. 2043 c.c.', limite: 5 });
    const second = await fetchCaseLawCached({ riferimento: 'art. 2043 c.c.', limite: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('shares one in-flight request across concurrent callers for the same key', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    const fetchMock = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    const p1 = fetchCaseLawCached({ riferimento: 'art. 2043 c.c.', limite: 5 });
    const p2 = fetchCaseLawCached({ riferimento: 'art. 2043 c.c.', limite: 5 });

    resolveFetch({ ok: true, status: 200, statusText: 'OK', json: async () => ({ fonti: [] }) });
    await Promise.all([p1, p2]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed request — a retry really refetches', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCaseLawCached({ riferimento: 'art. 2043 c.c.', limite: 5 })).rejects.toThrow();
    await expect(fetchCaseLawCached({ riferimento: 'art. 2043 c.c.', limite: 5 })).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps distinct riferimento strings in separate cache entries', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, statusText: 'OK', json: async () => ({ fonti: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchCaseLawCached({ riferimento: 'art. 2043 c.c.', limite: 5 });
    await fetchCaseLawCached({ riferimento: 'art. 3 Cost.', limite: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
