import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const legalFetch = vi.hoisted(() => vi.fn());
vi.mock('../../../../services/legalFetch', () => ({ legalFetch }));

import {
  BATCH_MAX_BYTES, BATCH_MAX_QUERIES, SERVER_TIMEOUT_MS, chunkQueries, fetchActNames, readOnServer,
} from '../documentServer';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sentQueries = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string).queries as string[];
/** The batch's answer: each string read as «recognized» with itself as the article, in order. */
const answering = () => legalFetch.mockImplementation(async (_path: string, init: RequestInit) =>
  json({ results: (JSON.parse(init.body as string).queries as string[]).map((q) => ({ recognized: true, parsed: { act_type: 'codice civile', article: q } })) }));

// A block, not an expression: a function returned by `beforeEach` is run as its cleanup.
beforeEach(() => { legalFetch.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('chunkQueries', () => {
  it('cuts by count: at most 200 strings a call', () => {
    const queries = Array.from({ length: 450 }, (_, i) => `art. ${i} c.c.`);
    expect(chunkQueries(queries).map((c) => c.length)).toEqual([BATCH_MAX_QUERIES, BATCH_MAX_QUERIES, 50]);
    expect(chunkQueries(queries).flat()).toEqual(queries);
  });

  it('cuts by bytes: accented letters and escapes weigh more than a character', () => {
    const queries = Array.from({ length: 200 }, (_, i) => `${i} ${'è"'.repeat(98)}`);
    const chunks = chunkQueries(queries);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(new TextEncoder().encode(JSON.stringify({ queries: chunk })).length).toBeLessThanOrEqual(BATCH_MAX_BYTES);
    }
    expect(chunks.flat()).toEqual(queries);
  });
});

describe('readOnServer', () => {
  it('posts the strings, a chunk at a time, through legalFetch, and keeps each answer by its string', async () => {
    answering();
    const queries = Array.from({ length: 250 }, (_, i) => `art. ${i} gdpr`);
    const { answers, unanswered } = await readOnServer(queries);
    expect(legalFetch).toHaveBeenCalledTimes(2);
    const [path, init] = legalFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/parse_query_batch');
    expect(init.method).toBe('POST');
    expect(sentQueries(legalFetch.mock.calls[0])).toHaveLength(200);
    expect(sentQueries(legalFetch.mock.calls[1])).toHaveLength(50);
    expect(answers.get('art. 249 gdpr')).toMatchObject({ parsed: { article: 'art. 249 gdpr' } });
    expect(unanswered).toEqual([]);
  });

  it('stops at the first chunk that fails: it and the rest are unanswered, never retried by themselves', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    legalFetch.mockImplementation(async (_path: string, init: RequestInit) => {
      calls += 1;
      if (calls === 2) return json({ error: 'quota' }, 429);
      return json({ results: (JSON.parse(init.body as string).queries as string[]).map(() => ({ recognized: false, parsed: null })) });
    });
    const queries = Array.from({ length: 450 }, (_, i) => `art. ${i} riservato`);
    const { answers, unanswered } = await readOnServer(queries);
    expect(legalFetch).toHaveBeenCalledTimes(2);
    expect(answers.size).toBe(200);
    expect(unanswered).toEqual(queries.slice(200));
    // Said, but not the strings: they are a confidential document's citations.
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/riservato/);
    error.mockRestore();
  });

  it('treats a network error, a server error and an answer of another length as silence', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    legalFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect((await readOnServer(['a'])).unanswered).toEqual(['a']);
    legalFetch.mockResolvedValueOnce(json({ error: 'x' }, 503));
    expect((await readOnServer(['a'])).unanswered).toEqual(['a']);
    legalFetch.mockResolvedValueOnce(json({ results: [] }));
    expect((await readOnServer(['a'])).unanswered).toEqual(['a']);
    error.mockRestore();
  });

  it('gives up on a chunk after 8 seconds', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    legalFetch.mockImplementation((_path: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = readOnServer(['art. 1 x']);
    await vi.advanceTimersByTimeAsync(SERVER_TIMEOUT_MS + 1);
    expect((await pending).unanswered).toEqual(['art. 1 x']);
    error.mockRestore();
  });

  it('sends no chunk after an abort between two chunks, and none at all when already aborted', async () => {
    const controller = new AbortController();
    legalFetch.mockImplementation(async (_path: string, init: RequestInit) => {
      controller.abort();
      return json({ results: (JSON.parse(init.body as string).queries as string[]).map(() => ({ recognized: false, parsed: null })) });
    });
    const queries = Array.from({ length: 450 }, (_, i) => `art. ${i} x`);
    await expect(readOnServer(queries, controller.signal)).rejects.toThrow();
    expect(legalFetch).toHaveBeenCalledTimes(1);
    legalFetch.mockClear();
    await expect(readOnServer(['a'], controller.signal)).rejects.toThrow();
    await expect(fetchActNames(controller.signal)).rejects.toThrow();
    expect(legalFetch).not.toHaveBeenCalled();
  });

  it('lets an abort of the page through, as an abort', async () => {
    const controller = new AbortController();
    legalFetch.mockImplementation((_path: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = readOnServer(['art. 1 x'], controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});

describe('fetchActNames', () => {
  it('reads the catalog’s act_names through legalFetch', async () => {
    legalFetch.mockResolvedValueOnce(json({ presets: {}, known_acts: ['legge'], act_names: ['c.c.', 'gdpr', 3] }));
    expect(await fetchActNames()).toEqual(['c.c.', 'gdpr']);
    expect(legalFetch.mock.calls[0][0]).toBe('/fetch_alias_catalog');
  });

  it('refuses a catalog without them (an API before PR 1)', async () => {
    legalFetch.mockResolvedValueOnce(json({ presets: {}, known_acts: [] }));
    await expect(fetchActNames()).rejects.toThrow();
  });
});
