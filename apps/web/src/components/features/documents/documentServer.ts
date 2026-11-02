/**
 * What «Analizza documento» asks the server (design 2026-10-29-document-analysis §4.2, §4.4, §4.7, §6.1): the names
 * of the acts, once per page; and the readings of the query strings the client parser could not settle, through
 * `/parse_query_batch`, in chunks, one after the other. The document, a passage, a bare article, the file's name
 * never leave: only distinct query strings, each at most 200 characters, in POST bodies.
 */
import { legalFetch } from '../../../services/legalFetch';
import type { ServerNormReading } from '../../../utils/normQuery';

/** How long one request may go unanswered before the page falls back on the browser (§4.7). */
export const SERVER_TIMEOUT_MS = 8000;
/** `/parse_query_batch`'s limits (`services/visualex/app.py`): 200 strings, the body at most 48 KB. */
export const BATCH_MAX_QUERIES = 200;
export const BATCH_MAX_BYTES = 48 * 1024;

/** An answer that did not come: a network error, the timeout, a refusal (429), a server error. */
export class ServerSilentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerSilentError';
  }
}

/** `fetch` through `legalFetch`, given up after `SERVER_TIMEOUT_MS` or when `signal` aborts. */
async function askWithin(path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  // An abort that came before the request: a listener added now would never hear it.
  signal?.throwIfAborted();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ServerSilentError('timeout')), SERVER_TIMEOUT_MS);
  const forward = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', forward, { once: true });
  try {
    const response = await legalFetch(path, { ...init, signal: controller.signal });
    if (!response.ok) throw new ServerSilentError(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw error instanceof ServerSilentError ? error : new ServerSilentError((error as Error)?.message ?? 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

/** The names that identify an act on their own (`/fetch_alias_catalog`'s `act_names`). */
export async function fetchActNames(signal?: AbortSignal): Promise<string[]> {
  const payload = await askWithin('/fetch_alias_catalog', {}, signal) as { act_names?: unknown };
  const names = payload?.act_names;
  if (!Array.isArray(names)) throw new ServerSilentError('no act_names in the catalog');
  return names.filter((name): name is string => typeof name === 'string');
}

const encoder = new TextEncoder();
const bodyOf = (queries: readonly string[]) => JSON.stringify({ queries });
/** `{"queries":[]}`: the body around the strings. */
const BODY_FRAME_BYTES = encoder.encode(bodyOf([])).length;

/** The query strings in chunks the endpoint accepts: by count and by encoded bytes (accents and escapes weigh more). */
export function chunkQueries(queries: readonly string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let bytes = BODY_FRAME_BYTES;
  for (const query of queries) {
    const weight = encoder.encode(JSON.stringify(query)).length;
    // A comma before every string but the first.
    if (current.length > 0 && (current.length + 1 > BATCH_MAX_QUERIES || bytes + 1 + weight > BATCH_MAX_BYTES)) {
      chunks.push(current);
      current = [];
      bytes = BODY_FRAME_BYTES;
    }
    bytes += (current.length > 0 ? 1 : 0) + weight;
    current.push(query);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export interface BatchReading {
  /** query → the server's answer. */
  answers: Map<string, ServerNormReading>;
  /** The queries left without an answer: the chunk that failed and the ones after it, never retried by themselves. */
  unanswered: string[];
}

/**
 * Reads the query strings on the server, a chunk at a time. A chunk that fails stops the reading: the rest are
 * `unanswered`, and the page falls back on the browser for them until the user asks again («Riprova»).
 */
export async function readOnServer(queries: readonly string[], signal?: AbortSignal): Promise<BatchReading> {
  const answers = new Map<string, ServerNormReading>();
  const chunks = chunkQueries(queries);
  for (let i = 0; i < chunks.length; i += 1) {
    // The page or the file has gone between two chunks: the rest are not sent (each costs points of the quota).
    signal?.throwIfAborted();
    const chunk = chunks[i];
    try {
      const payload = await askWithin('/parse_query_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyOf(chunk),
      }, signal) as { results?: unknown };
      const results = payload?.results;
      if (!Array.isArray(results) || results.length !== chunk.length) throw new ServerSilentError('an answer of another length');
      chunk.forEach((query, at) => answers.set(query, (results[at] ?? {}) as ServerNormReading));
    } catch (error) {
      if (signal?.aborted) throw error;
      // Never swallowed (gotcha 18): the page says it on screen too. The strings are not logged: they are the
      // citations of a document the user may hold confidential.
      console.error('«Analizza documento»: the server did not read the citations', (error as Error).message);
      return { answers, unanswered: chunks.slice(i).flat() };
    }
  }
  return { answers, unanswered: [] };
}
