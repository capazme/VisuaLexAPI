import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchArticleForNorma, clearArticleCache } from './articleFetchCache';
import type { NormaVisitata } from '../types';

const norma: NormaVisitata = {
  tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '2043',
};
const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

beforeEach(() => { clearArticleCache(); vi.restoreAllMocks(); });

describe('fetchArticleForNorma', () => {
  it('POSTs /fetch_article_text with the mapped body and returns the first result', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ok([{ article_text: 'Qualunque fatto...', norma_data: norma }]));
    const res = await fetchArticleForNorma(norma);
    expect(res.article_text).toBe('Qualunque fatto...');
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('/fetch_article_text');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      act_type: 'codice civile', act_number: '262', date: '1942-03-16',
      article: '2043', version: 'vigente', show_brocardi_info: false,
    });
  });
  it('caches by norm identity: second call does not refetch', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ok([{ article_text: 'testo', norma_data: norma }]));
    await fetchArticleForNorma(norma);
    await fetchArticleForNorma({ ...norma });
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('dedupes in-flight requests', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ok([{ article_text: 'testo', norma_data: norma }]));
    await Promise.all([fetchArticleForNorma(norma), fetchArticleForNorma(norma)]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('throws on backend error and does not poison the cache', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(ok([{ error: 'Articolo non trovato', norma_data: norma }]))
      .mockResolvedValueOnce(ok([{ article_text: 'testo', norma_data: norma }]));
    await expect(fetchArticleForNorma(norma)).rejects.toThrow('Articolo non trovato');
    await expect(fetchArticleForNorma(norma)).resolves.toMatchObject({ article_text: 'testo' });
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it('runs at most 3 fetches concurrently', async () => {
    let active = 0, peak = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 5));
      active--;
      const body = JSON.parse((init as RequestInit).body as string);
      return ok([{ article_text: 't', norma_data: { ...norma, numero_articolo: body.article } }]);
    });
    await Promise.all(['1', '2', '3', '4', '5'].map(numero_articolo =>
      fetchArticleForNorma({ ...norma, numero_articolo })));
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe('fetchArticleForNorma — versions of one article', () => {
  const IN_FORCE: NormaVisitata = { ...norma, numero_articolo: '1284' };
  const PAST: NormaVisitata = { ...IN_FORCE, versione: 'vigente', data_versione: '2007-12-29' };

  // The server answers with the text of the version in the request body.
  function answerWithTheVersionAsked() {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      return ok([{ article_text: `testo ${body.version} ${body.version_date}`.trim(), norma_data: IN_FORCE }]);
    });
  }
  const bodies = (spy: ReturnType<typeof answerWithTheVersionAsked>) =>
    spy.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

  it('asks for each version and hands each caller its own text, text in force first', async () => {
    const spy = answerWithTheVersionAsked();
    const current = await fetchArticleForNorma(IN_FORCE);
    const past = await fetchArticleForNorma(PAST);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(bodies(spy)[0]).toMatchObject({ version: 'vigente', version_date: '' });
    expect(bodies(spy)[1]).toMatchObject({ version: 'vigente', version_date: '2007-12-29' });
    expect(current.article_text).toBe('testo vigente');
    expect(past.article_text).toBe('testo vigente 2007-12-29');
  });

  it('and in the other order', async () => {
    const spy = answerWithTheVersionAsked();
    const past = await fetchArticleForNorma(PAST);
    const current = await fetchArticleForNorma(IN_FORCE);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(past.article_text).toBe('testo vigente 2007-12-29');
    expect(current.article_text).toBe('testo vigente');
  });

  it('keeps two concurrent versions apart too', async () => {
    const spy = answerWithTheVersionAsked();
    const [current, past] = await Promise.all([fetchArticleForNorma(IN_FORCE), fetchArticleForNorma(PAST)]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(current.article_text).toBe('testo vigente');
    expect(past.article_text).toBe('testo vigente 2007-12-29');
  });

  it('asks once for the same version asked twice (cache hit)', async () => {
    const spy = answerWithTheVersionAsked();
    await fetchArticleForNorma(PAST);
    await fetchArticleForNorma({ ...PAST });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('shares one request between two concurrent calls for the same version', async () => {
    const spy = answerWithTheVersionAsked();
    const [a, b] = await Promise.all([fetchArticleForNorma(PAST), fetchArticleForNorma({ ...PAST })]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('reads " Originale " and "originale" as one text', async () => {
    const spy = answerWithTheVersionAsked();
    await fetchArticleForNorma({ ...IN_FORCE, versione: ' Originale ' });
    await fetchArticleForNorma({ ...IN_FORCE, versione: 'originale' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('reads a missing version and "vigente" with no day as one text', async () => {
    const spy = answerWithTheVersionAsked();
    await fetchArticleForNorma(IN_FORCE);
    await fetchArticleForNorma({ ...IN_FORCE, versione: 'vigente', data_versione: '' });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
