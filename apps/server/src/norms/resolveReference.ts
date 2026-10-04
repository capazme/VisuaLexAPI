/**
 * From a reference written by a person or a model ("art. 2043 c.c.") to the
 * norm the dossier stores, checked for existence (MCP spike, spec section 7).
 *
 * Every step asks the Python API, which owns the parsing and the sources:
 * 1. `POST /parse_query`: preset aliases, then the natural-language parser.
 *    Not recognised, or recognised without naming exactly one article of one
 *    identified act, stops here (`not_recognised`, `ambiguous`).
 * 2. `POST /fetch_norma_data`: the norm as the reader stores it (the same
 *    object the web app puts in a dossier), and a first existence check where
 *    the act's tree is known ("Articolo N non presente …").
 * 3. Existence, once per act for the whole batch. A Normattiva act with a
 *    single part is decided on `POST /fetch_act_fingerprints` (an article
 *    exists if its number is a key). An act with annexes is decided on its
 *    tree (`POST /fetch_tree`), which lists (annex, article) pairs: the
 *    fingerprints cover the dominant part only, and art. 40 of the code is not
 *    art. 40 of the preleggi. With neither, the reference is `unavailable`:
 *    the text alone proves nothing, since Normattiva answers a request for a
 *    missing article with the act's art. 1 and a 200. An EU act (no AKN
 *    export) is decided on its article's text, where EUR-Lex does say "not
 *    found".
 * An article that does not exist must never reach a dossier: a previous bug
 * did exactly that. A source that fails, or answers 429 (the Python API limits
 * each address), makes the references it touched `unavailable`, never
 * "missing" or "not recognised".
 */

export type ReferenceOutcome = 'resolved' | 'not_recognised' | 'does_not_exist' | 'ambiguous' | 'unavailable';

/** The norm as `fetch_norma_data` returns it and the reader stores it. */
export interface NormaVisitata {
  tipo_atto: string;
  data: string | null;
  numero_atto: string | null;
  numero_articolo: string;
  urn: string;
  url: string;
  allegato?: string | null;
  tipo_atto_reale?: string | null;
  versione?: string | null;
  data_versione?: string | null;
}

export interface Resolution {
  outcome: ReferenceOutcome;
  norm?: NormaVisitata;
  /** How the norm reads, for the answer ("Art. 2043 — codice civile"). */
  display?: string;
  /** Why it was not resolved, in Italian, for the person reading the answer. */
  detail?: string;
}

const TIMEOUT_MS = 30_000;
const CONCURRENCY = 5;

const apiBase = (): string => (process.env.LEGAL_API_URL || 'http://localhost:5000').replace(/\/+$/, '');

class SourceUnavailable extends Error {}

/** A status that says nothing about the reference: the source is down, slow or limiting us. */
const sourceFailed = (status: number): boolean => status === 429 || status >= 500 || status === 0;

async function post(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new SourceUnavailable(error instanceof Error ? error.message : String(error));
  }
  const data = (await response.json().catch(() => ({}))) as unknown;
  return { status: response.status, data: data && typeof data === 'object' ? (data as Record<string, unknown>) : {} };
}

/** Runs `task` over `items` with at most `limit` in flight, keeping the order. */
async function mapLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// "2043,2059", "2043 e 2059", "1-3": more than one article in one reference.
const SEVERAL_ARTICLES = /[,;]|\s(e|ed)\s|^\d+\s*-\s*\d+$/i;
const NOT_PRESENT = /non presente/i;

// "2645-bis", "2645 bis", "2645bis" → "2645-bis": the fingerprints, the tree and the norm write it differently.
const articleKey = (article: string): string =>
  article.toLowerCase().trim().replace(/[\s-]+/g, '-').replace(/^(\d+)([a-z])/, '$1-$2');

/** Steps 1 and 2 for one reference: what it names, or why not. */
async function identify(reference: string): Promise<Resolution> {
  const parsed = await post('/parse_query', { query: reference });
  if (parsed.status !== 200) throw new SourceUnavailable(`parse_query ${parsed.status}`);
  const params = parsed.data.parsed as Record<string, string> | null | undefined;
  if (!parsed.data.recognized || !params?.act_type) {
    return { outcome: 'not_recognised', detail: 'Riferimento non riconosciuto: indica articolo e atto (es. «art. 2043 c.c.»).' };
  }
  const display = typeof parsed.data.display === 'string' ? parsed.data.display : undefined;
  if (!params.article) {
    return { outcome: 'ambiguous', display, detail: 'Manca l’articolo: indica un solo articolo per riferimento.' };
  }
  if (SEVERAL_ARTICLES.test(params.article)) {
    return { outcome: 'ambiguous', display, detail: 'Il riferimento indica più articoli: scrivine uno per riferimento.' };
  }

  const fetched = await post('/fetch_norma_data', params);
  if (NOT_PRESENT.test(String(fetched.data.error ?? ''))) {
    return { outcome: 'does_not_exist', display, detail: String(fetched.data.error) };
  }
  if (sourceFailed(fetched.status)) throw new SourceUnavailable(`fetch_norma_data ${fetched.status}`);
  if (fetched.status !== 200) {
    return { outcome: 'ambiguous', display, detail: 'Il riferimento non individua un articolo di un atto preciso.' };
  }
  const norms = Array.isArray(fetched.data.norma_data) ? (fetched.data.norma_data as NormaVisitata[]) : [];
  if (norms.length !== 1) {
    return { outcome: 'ambiguous', display, detail: 'Il riferimento non individua un solo articolo.' };
  }
  const norm = norms[0];
  // An act that needs a number and a date and was given neither builds a URN
  // with "None" in it: the type of act is known, the act is not.
  if (!norm.url || /None/.test(norm.url)) {
    return { outcome: 'ambiguous', display, detail: 'Indica numero e data dell’atto (es. «art. 2 l. 241/1990»).' };
  }
  return { outcome: 'resolved', norm, display };
}

type Verdict = 'exists' | 'missing' | 'unknown';

/** Step 3: one decision per act, for every reference that names it. */
async function confirmExistence(resolutions: Resolution[]): Promise<void> {
  const byAct = new Map<string, Resolution[]>();
  for (const resolution of resolutions) {
    if (resolution.outcome !== 'resolved' || !resolution.norm) continue;
    const act = resolution.norm.url;
    byAct.set(act, [...(byAct.get(act) ?? []), resolution]);
  }

  await mapLimited([...byAct.entries()], CONCURRENCY, async ([act, group]) => {
    let verdicts: Verdict[];
    try {
      verdicts = act.includes('eur-lex')
        ? await mapLimited(group, CONCURRENCY, (resolution) => euArticleVerdict(resolution.norm!))
        : await normattivaVerdicts(act, group.map((resolution) => resolution.norm!));
    } catch (error) {
      if (!(error instanceof SourceUnavailable)) throw error;
      verdicts = group.map(() => 'unknown');
    }
    group.forEach((resolution, i) => {
      if (verdicts[i] === 'missing') markMissing(resolution);
      else if (verdicts[i] === 'unknown') markUnverifiable(resolution);
    });
  });
}

/** Fingerprints for a single-part act; the tree, annex by annex, otherwise. */
async function normattivaVerdicts(act: string, norms: NormaVisitata[]): Promise<Verdict[]> {
  const answer = await post('/fetch_act_fingerprints', { urn: act });
  const fingerprints =
    answer.status === 200 && answer.data.available === true && answer.data.fingerprints && typeof answer.data.fingerprints === 'object'
      ? (answer.data.fingerprints as Record<string, unknown>)
      : null;
  const parts = Array.isArray(answer.data.parts) ? answer.data.parts.length : 0;
  if (fingerprints && parts <= 1) {
    const keys = new Set(Object.keys(fingerprints).map(articleKey));
    return norms.map((norm) => (keys.has(articleKey(norm.numero_articolo)) ? 'exists' : 'missing'));
  }

  const tree = await post('/fetch_tree', { urn: act, return_metadata: false });
  const articles = tree.status === 200 && Array.isArray(tree.data.articles) ? (tree.data.articles as unknown[]) : null;
  if (!articles) return norms.map(() => 'unknown');
  const pairs = new Set(
    articles
      .filter((a): a is { allegato?: unknown; numero?: unknown } => Boolean(a) && typeof a === 'object')
      .filter((a) => typeof a.numero === 'string')
      .map((a) => `${a.allegato ?? ''}|${articleKey(a.numero as string)}`),
  );
  if (pairs.size === 0) return norms.map(() => 'unknown');
  return norms.map((norm) => (pairs.has(`${norm.allegato ?? ''}|${articleKey(norm.numero_articolo)}`) ? 'exists' : 'missing'));
}

// What EUR-Lex's reader says of an article it cannot find; any other error is the source failing.
const EU_NOT_FOUND = /not found|non trovat|non presente|DocumentNotFound/i;

async function euArticleVerdict(norm: NormaVisitata): Promise<Verdict> {
  const answer = await post('/fetch_article_text', {
    act_type: norm.tipo_atto,
    act_number: norm.numero_atto ?? '',
    date: norm.data ?? '',
    article: norm.numero_articolo,
    version: 'vigente',
    show_brocardi_info: false,
  });
  if (answer.status !== 200) return 'unknown';
  // The endpoint answers an array, one entry per article asked; errors ride inside a 200.
  const list: unknown[] = Array.isArray(answer.data) ? answer.data : [];
  const first = list[0] as { article_text?: unknown; error?: unknown } | undefined;
  if (!first) return 'unknown';
  if (first.error) return EU_NOT_FOUND.test(String(first.error)) ? 'missing' : 'unknown';
  return typeof first.article_text === 'string' && first.article_text.trim() ? 'exists' : 'unknown';
}

function markMissing(resolution: Resolution): void {
  resolution.outcome = 'does_not_exist';
  resolution.detail = 'L’articolo non esiste nell’atto indicato.';
  delete resolution.norm;
}

function markUnverifiable(resolution: Resolution): void {
  resolution.outcome = 'unavailable';
  resolution.detail = 'Impossibile verificare che l’articolo esista: riprova più tardi.';
  delete resolution.norm;
}

/**
 * Resolves a batch of references: the outcome of each, in order. A failure of
 * the sources marks the references it touched `unavailable`; it never stops
 * the others, and never lets an unchecked article through.
 */
export async function resolveReferences(references: string[]): Promise<Resolution[]> {
  const resolutions = await mapLimited(references, CONCURRENCY, async (reference) => {
    try {
      return await identify(reference);
    } catch (error) {
      if (!(error instanceof SourceUnavailable)) throw error;
      return { outcome: 'unavailable', detail: 'Fonte non raggiungibile: riprova più tardi.' } as Resolution;
    }
  });
  await confirmExistence(resolutions);
  return resolutions;
}

/** One reference (the plan's interface); the batch form is what routes use. */
export async function resolveReference(reference: string): Promise<Resolution> {
  return (await resolveReferences([reference]))[0];
}
