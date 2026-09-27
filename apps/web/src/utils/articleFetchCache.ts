import type { ArticleData, NormaVisitata } from '../types';
import { buildItemKey } from './normaKeys';

// Session-only cache: deliberately NOT persisted and NOT in the Zustand store
// (must never enter the persist partialize).
const cache = new Map<string, ArticleData>();
const inFlight = new Map<string, Promise<ArticleData>>();

// "Espandi tutto" mounts many readers at once; cap parallel scraper calls.
const MAX_CONCURRENT = 3;
let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) { active++; return Promise.resolve(); }
  return new Promise((resolve) => waiters.push(() => { active++; resolve(); }));
}
function release(): void { active--; waiters.shift()?.(); }

export function clearArticleCache(): void { cache.clear(); inFlight.clear(); }

export function fetchArticleForNorma(norma: NormaVisitata): Promise<ArticleData> {
  const key = buildItemKey(norma);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    await acquire();
    try {
      const response = await fetch('/fetch_article_text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          act_type: norma.tipo_atto,
          act_number: norma.numero_atto || '',
          date: norma.data || '',
          article: norma.numero_articolo?.toString() || '',
          version: norma.versione || 'vigente',
          version_date: norma.data_versione || '',
          show_brocardi_info: false,
          ...(norma.allegato ? { annex: norma.allegato } : {}),
        }),
      });
      if (!response.ok) throw new Error(`Errore nella richiesta (${response.status})`);
      const results = (await response.json()) as ArticleData[] | ArticleData;
      const first = Array.isArray(results) ? results[0] : results;
      if (!first || first.error || !first.article_text) {
        throw new Error(first?.error || 'Testo non disponibile');
      }
      cache.set(key, first);
      return first;
    } finally {
      release();
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}
