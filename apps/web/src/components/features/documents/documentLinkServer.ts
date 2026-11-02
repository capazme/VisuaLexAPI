/**
 * The addresses of a document's norms, from `POST /fetch_norm_links` (design 2026-10-31-document-hyperlinks §3.1, L1
 * #395): the norms the user will link, as readings, each distinct norm once, in chunks the route accepts — at most 200
 * norms and 30 distinct acts a call, the body at most 48 KB — one call after the other, 25 s each (the route has
 * 20 s of its own budget). Never the text, a passage, the place of a citation. The link is dated by the server to
 * today in Rome (G-395): no `pin_day` is sent.
 */
import { legalFetch } from '../../../services/legalFetch';
import type { LinkAnswer, LinkNorm, LinkReading } from './documentLinks';
import { normKey } from './documentLinks';

export const LINKS_TIMEOUT_MS = 25_000;
export const LINKS_MAX_NORMS = 200;
export const LINKS_MAX_ACTS = 30;
export const LINKS_MAX_BYTES = 48 * 1024;

const encoder = new TextEncoder();
/** `{"norms":[]}`: the body around the norms. */
const FRAME_BYTES = encoder.encode(JSON.stringify({ norms: [] })).length;
/**
 * One act toward the 30 of a call. The server counts `normalize_act_type` of the type: it folds the case of every type
 * but «TUE», «TFUE», «CDFUE», which it keeps as written, so two spellings may be one act there. Counted here on the
 * type exactly as written, the browser never counts fewer acts than the server, and a chunk is never refused.
 */
const actOf = (norm: LinkNorm) => JSON.stringify([norm.act_type, norm.act_number ?? '', norm.date ?? '']);

/** The norms in chunks the route accepts, the norms of one act kept together where they fit. */
export function chunkNorms(norms: readonly LinkNorm[]): LinkNorm[][] {
  const byAct = new Map<string, LinkNorm[]>();
  for (const norm of norms) {
    const act = actOf(norm);
    byAct.set(act, [...(byAct.get(act) ?? []), norm]);
  }
  const chunks: LinkNorm[][] = [];
  let current: LinkNorm[] = [];
  let acts = new Set<string>();
  let bytes = FRAME_BYTES;
  const flush = () => {
    if (current.length) chunks.push(current);
    current = [];
    acts = new Set();
    bytes = FRAME_BYTES;
  };
  for (const [act, group] of byAct) {
    for (const norm of group) {
      const weight = encoder.encode(JSON.stringify(norm)).length + (current.length ? 1 : 0);
      const newAct = !acts.has(act);
      if (current.length && (current.length + 1 > LINKS_MAX_NORMS || (newAct && acts.size + 1 > LINKS_MAX_ACTS) || bytes + weight > LINKS_MAX_BYTES)) flush();
      bytes += encoder.encode(JSON.stringify(norm)).length + (current.length ? 1 : 0);
      current.push(norm);
      acts.add(act);
    }
  }
  flush();
  return chunks;
}

const REASONS: ReadonlySet<string> = new Set(['ok', 'date_incomplete', 'article_missing', 'ambiguous_part', 'source_unavailable', 'not_linkable']);

async function askChunk(norms: LinkNorm[], signal?: AbortSignal): Promise<LinkAnswer[]> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), LINKS_TIMEOUT_MS);
  const forward = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', forward, { once: true });
  try {
    const response = await legalFetch('/fetch_norm_links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ norms }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const results = (await response.json() as { results?: unknown })?.results;
    if (!Array.isArray(results) || results.length !== norms.length) throw new Error('an answer of another length');
    return results.map((result) => {
      const { href, reason } = (result ?? {}) as { href?: unknown; reason?: unknown };
      const known = typeof reason === 'string' && REASONS.has(reason) ? reason as LinkAnswer['reason'] : 'source_unavailable';
      return { href: known === 'ok' && typeof href === 'string' ? href : null, reason: known === 'ok' && typeof href !== 'string' ? 'source_unavailable' : known };
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

/**
 * The addresses of `norms`, by `normKey`. A chunk that fails (a network error, 25 s, a 429, a 5xx, an answer of another
 * length) stops the reading: it and the chunks after it are `unanswered`, for «Riprova». The log names neither a norm
 * nor an address.
 */
export async function fetchNormLinks(norms: readonly LinkNorm[], signal?: AbortSignal): Promise<LinkReading> {
  const answers = new Map<string, LinkAnswer>();
  const chunks = chunkNorms(norms);
  for (let i = 0; i < chunks.length; i += 1) {
    signal?.throwIfAborted();
    try {
      const results = await askChunk(chunks[i], signal);
      chunks[i].forEach((norm, at) => answers.set(normKey(norm), results[at]));
    } catch (error) {
      if (signal?.aborted) throw error;
      console.error('«Analizza documento»: the addresses of the norms did not come', (error as Error)?.message);
      return { answers, unanswered: chunks.slice(i).flat().map(normKey) };
    }
  }
  return { answers, unanswered: [] };
}
