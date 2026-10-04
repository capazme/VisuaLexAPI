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
 * 3. `POST /fetch_act_fingerprints`, once per act for the whole batch: an
 *    article exists if its number is a key of the answer. When the act has no
 *    AKN index (`available: false`, or an EU act, which has no AKN export) the
 *    article's own text is fetched instead.
 * An article that does not exist must never reach a dossier: a previous bug
 * did exactly that.
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

const articleKey = (article: string): string => article.toLowerCase().replace(/\s+/g, '').replace(/^(\d+)([a-z])/, '$1-$2');

/** Steps 1 and 2 for one reference: what it names, or why not. */
async function identify(reference: string): Promise<Resolution> {
  const parsed = await post('/parse_query', { query: reference });
  if (parsed.status >= 500) throw new SourceUnavailable(`parse_query ${parsed.status}`);
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
  if (fetched.status >= 500 && !NOT_PRESENT.test(String(fetched.data.error ?? ''))) {
    throw new SourceUnavailable(`fetch_norma_data ${fetched.status}`);
  }
  if (NOT_PRESENT.test(String(fetched.data.error ?? ''))) {
    return { outcome: 'does_not_exist', display, detail: String(fetched.data.error) };
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

/** Step 3: one fingerprint call per act; per-article fallback when it has no index. */
async function confirmExistence(resolutions: Resolution[]): Promise<void> {
  const byAct = new Map<string, Resolution[]>();
  for (const resolution of resolutions) {
    if (resolution.outcome !== 'resolved' || !resolution.norm) continue;
    const act = resolution.norm.url;
    byAct.set(act, [...(byAct.get(act) ?? []), resolution]);
  }

  await mapLimited([...byAct.entries()], CONCURRENCY, async ([act, group]) => {
    let fingerprints: Record<string, unknown> | null = null;
    if (!act.includes('eur-lex')) {
      const answer = await post('/fetch_act_fingerprints', { urn: act });
      if (answer.status >= 500) throw new SourceUnavailable(`fetch_act_fingerprints ${answer.status}`);
      if (answer.data.available === true && answer.data.fingerprints && typeof answer.data.fingerprints === 'object') {
        fingerprints = answer.data.fingerprints as Record<string, unknown>;
      }
    }
    if (fingerprints) {
      const keys = new Set(Object.keys(fingerprints).map(articleKey));
      for (const resolution of group) {
        if (!keys.has(articleKey(resolution.norm!.numero_articolo))) markMissing(resolution);
      }
      return;
    }
    await mapLimited(group, CONCURRENCY, async (resolution) => {
      if (!(await articleHasText(resolution.norm!))) markMissing(resolution);
    });
  });
}

function markMissing(resolution: Resolution): void {
  resolution.outcome = 'does_not_exist';
  resolution.detail = 'L’articolo non esiste nell’atto indicato.';
  delete resolution.norm;
}

async function articleHasText(norm: NormaVisitata): Promise<boolean> {
  const answer = await post('/fetch_article_text', {
    act_type: norm.tipo_atto,
    act_number: norm.numero_atto ?? '',
    date: norm.data ?? '',
    article: norm.numero_articolo,
    version: 'vigente',
    annex: norm.allegato ?? undefined,
    show_brocardi_info: false,
  });
  if (answer.status >= 500) throw new SourceUnavailable(`fetch_article_text ${answer.status}`);
  // The endpoint answers an array, one entry per article asked.
  const list: unknown[] = Array.isArray(answer.data) ? answer.data : [];
  const first = list[0] as { article_text?: unknown; error?: unknown } | undefined;
  return Boolean(first && !first.error && typeof first.article_text === 'string' && first.article_text.trim());
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
  try {
    await confirmExistence(resolutions);
  } catch (error) {
    if (!(error instanceof SourceUnavailable)) throw error;
    for (const resolution of resolutions) {
      if (resolution.outcome === 'resolved') {
        resolution.outcome = 'unavailable';
        resolution.detail = 'Impossibile verificare che l’articolo esista: riprova più tardi.';
        delete resolution.norm;
      }
    }
  }
  return resolutions;
}

/** One reference (the plan's interface); the batch form is what routes use. */
export async function resolveReference(reference: string): Promise<Resolution> {
  return (await resolveReferences([reference]))[0];
}
