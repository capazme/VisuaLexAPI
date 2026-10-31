/**
 * The Massimario's reviews, read from the Python API's own store (`POST /fetch_rassegne`, through
 * legalFetch: behind the login, ADR-001), and the reference of another article read by
 * `/parse_query`. Design `2026-10-30-rassegne-without-merlt` §3 (a), PR 2; the keyword search is
 * G-399. No MERL-T hop: the reviews show with MERL-T off.
 */
import { legalFetch } from './legalFetch';
import type { RassegneQuery, RassegneResponse } from '../components/features/rassegne/types';

/** A load that did not answer the reviews: `status` is the HTTP status, undefined when no answer came. */
export class RassegneError extends Error {
  readonly status: number | undefined;
  constructor(status: number | undefined) {
    super(status === undefined ? 'rassegne: no answer' : `rassegne: HTTP ${status}`);
    this.name = 'RassegneError';
    this.status = status;
  }
}

/**
 * A page of the paragraphs citing a norm. A POST, so a keyword search (`q`) never sits in an
 * address, where access logs keep it (the route refuses `q` in a query string).
 */
export async function fetchRassegne(query: RassegneQuery): Promise<RassegneResponse> {
  const body: Record<string, string | number> = { urn: query.urn };
  if (query.anno !== undefined) body.anno = query.anno;
  if (query.archivio) body.archivio = query.archivio;
  if (query.cursor) body.cursor = query.cursor;
  if (query.q) body.q = query.q;
  let response: Response;
  try {
    response = await legalFetch('/fetch_rassegne', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new RassegneError(undefined);
  }
  if (!response.ok) throw new RassegneError(response.status);
  try {
    return (await response.json()) as RassegneResponse;
  } catch {
    throw new RassegneError(response.status);
  }
}

export type ArticleReference =
  | { esito: 'articolo'; urn: string; label: string }
  /** read, but naming no article (an act alone) or more than one */
  | { esito: 'non_un_articolo' }
  | { esito: 'non_riconosciuto' }
  | { esito: 'non_disponibile' };

/** A list or a range of articles, as `/parse_query` tells them apart. */
const SEVERAL = /,|^\s*\d+\s*-\s*\d+\s*$/;

/** «art. 1218 c.c.» → the article's URN and its citation, through the parser the search field uses. */
export async function readArticleReference(text: string): Promise<ArticleReference> {
  let response: Response;
  try {
    response = await legalFetch('/parse_query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: text }),
    });
  } catch {
    return { esito: 'non_disponibile' };
  }
  if (!response.ok) return { esito: 'non_disponibile' };
  let data: { recognized?: boolean; urn?: string | null; display?: string | null; parsed?: { article?: unknown } | null };
  try {
    data = await response.json();
  } catch {
    return { esito: 'non_disponibile' };
  }
  if (!data.recognized || !data.parsed) return { esito: 'non_riconosciuto' };
  const article = String(data.parsed.article ?? '').trim();
  if (!article || SEVERAL.test(article)) return { esito: 'non_un_articolo' };
  if (!data.urn) return { esito: 'non_disponibile' };
  return { esito: 'articolo', urn: data.urn, label: data.display || text.trim() };
}
