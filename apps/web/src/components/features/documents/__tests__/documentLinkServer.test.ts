import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const legalFetch = vi.hoisted(() => vi.fn());
vi.mock('../../../../services/legalFetch', () => ({ legalFetch }));

import { normKey, type LinkNorm } from '../documentLinks';
import { LINKS_MAX_ACTS, LINKS_MAX_BYTES, LINKS_MAX_NORMS, LINKS_TIMEOUT_MS, chunkNorms, fetchNormLinks } from '../documentLinkServer';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sent = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string) as { norms: LinkNorm[]; pin_day?: string };
const article = (act: number, art: number): LinkNorm => ({ act_type: 'legge', act_number: String(act), date: '2000', article: String(art) });
const answering = () => legalFetch.mockImplementation(async (_path: string, init: RequestInit) =>
  json({ results: (JSON.parse(init.body as string).norms as LinkNorm[]).map((n) => ({ href: `https://www.normattiva.it/x~art${n.article}`, reason: 'ok' })) }));

// A block, not an expression: a function returned by `beforeEach` is run as its cleanup.
beforeEach(() => { legalFetch.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('chunkNorms', () => {
  it('at most 200 norms a call', () => {
    const norms = Array.from({ length: 450 }, (_, i) => article(1, i));
    expect(chunkNorms(norms).map((c) => c.length)).toEqual([LINKS_MAX_NORMS, LINKS_MAX_NORMS, 50]);
  });

  it('at most 30 distinct acts a call, an act’s norms kept together', () => {
    const norms = Array.from({ length: 70 }, (_, i) => article(i % 35, i));
    const chunks = chunkNorms(norms);
    for (const chunk of chunks) expect(new Set(chunk.map((n) => n.act_number)).size).toBeLessThanOrEqual(LINKS_MAX_ACTS);
    expect(chunks).toHaveLength(2);
    expect(new Set(chunks[0].map((n) => n.act_number)).size).toBe(30);
    expect(chunks.flat()).toHaveLength(70);
  });

  it('at most 48 KB a body', () => {
    const norms = Array.from({ length: 200 }, (_, i) => ({ act_type: 'è'.repeat(119), article: String(i) }));
    for (const chunk of chunkNorms(norms)) {
      expect(new TextEncoder().encode(JSON.stringify({ norms: chunk })).length).toBeLessThanOrEqual(LINKS_MAX_BYTES);
    }
  });
});

describe('fetchNormLinks', () => {
  it('posts the norms alone, no pin_day (the server dates the link to today, G-395), and keeps each answer by norm', async () => {
    answering();
    const norms = [article(241, 3), article(241, 7)];
    const { answers, unanswered } = await fetchNormLinks(norms);
    expect(legalFetch.mock.calls[0][0]).toBe('/fetch_norm_links');
    expect(sent(legalFetch.mock.calls[0])).toEqual({ norms });
    expect(answers.get(normKey(norms[1]))).toEqual({ href: 'https://www.normattiva.it/x~art7', reason: 'ok' });
    expect(unanswered).toEqual([]);
  });

  it('reads an unknown reason, or ok with no address, as the source silent', async () => {
    legalFetch.mockResolvedValueOnce(json({ results: [{ href: null, reason: 'weird' }, { href: null, reason: 'ok' }, { href: 'x', reason: 'date_incomplete' }] }));
    const norms = [article(1, 1), article(1, 2), article(1, 3)];
    const { answers } = await fetchNormLinks(norms);
    expect(norms.map((n) => answers.get(normKey(n)))).toEqual([
      { href: null, reason: 'source_unavailable' }, { href: null, reason: 'source_unavailable' }, { href: null, reason: 'date_incomplete' },
    ]);
  });

  it('stops at a chunk that fails: it and the rest are unanswered; the log names no norm', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    legalFetch.mockImplementation(async (_path: string, init: RequestInit) => {
      calls += 1;
      if (calls === 2) return json({ error: 'quota' }, 429);
      return json({ results: (JSON.parse(init.body as string).norms as LinkNorm[]).map(() => ({ href: null, reason: 'article_missing' })) });
    });
    const norms = Array.from({ length: 450 }, (_, i) => ({ ...article(1, i), act_type: 'riservatissimo' }));
    const { answers, unanswered } = await fetchNormLinks(norms);
    expect(legalFetch).toHaveBeenCalledTimes(2);
    expect(answers.size).toBe(200);
    expect(unanswered).toHaveLength(250);
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/riservatissimo/);
    error.mockRestore();
  });

  it('gives up on a call after 25 seconds', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    legalFetch.mockImplementation((_path: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = fetchNormLinks([article(1, 1)]);
    await vi.advanceTimersByTimeAsync(LINKS_TIMEOUT_MS + 1);
    expect((await pending).unanswered).toHaveLength(1);
    error.mockRestore();
  });

  it('sends nothing more once aborted', async () => {
    const controller = new AbortController();
    legalFetch.mockImplementation(async (_path: string, init: RequestInit) => {
      controller.abort();
      return json({ results: (JSON.parse(init.body as string).norms as LinkNorm[]).map(() => ({ href: null, reason: 'not_linkable' })) });
    });
    await expect(fetchNormLinks(Array.from({ length: 300 }, (_, i) => article(1, i)), controller.signal)).rejects.toThrow();
    expect(legalFetch).toHaveBeenCalledTimes(1);
  });
});
