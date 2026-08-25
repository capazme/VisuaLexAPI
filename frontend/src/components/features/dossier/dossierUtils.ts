import { formatDateItalianLong } from '../../../utils/dateUtils';
import { normalizeArticleId } from '../../../utils/treeUtils';
import { uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import type { Dossier, DossierItem, NormaVisitata, SearchParams } from '../../../types';

// Legacy 4-value status union kept for data + type compat with older dossier
// items (server payloads and `AddItemsDialog` still reference the full type).
// The UI now only ever writes/reads 'unread' | 'important' (see the amber
// star in SortableDossierItem) — 'reading' and 'done' are inert leftovers.
export type DossierItemStatus = 'unread' | 'reading' | 'important' | 'done';

// Turn a stored timestamp (ISO string or epoch ms) into the Italian long format
// used across the app, e.g. "7 agosto 1990". Falls back to the raw input when
// parsing fails so the UI degrades to something-readable rather than "Invalid Date".
export function formatTimestampLong(ts: string | number | undefined | null): string {
  if (ts === undefined || ts === null || ts === '') return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return formatDateItalianLong(d.toISOString().slice(0, 10));
}

// One group = one norm (tipo + numero + data) and all its articles in the dossier.
// Used both by the detail view ("Apri tutti su Dashboard") and the list view
// ("apri rapido dalla card"). `triggerSearch` in the store overwrites any
// previous search, so the consuming UI must pick a single group to open at
// once — see OpenOnDashboardPicker for the multi-group UX.
export interface NormaGroup {
  key: string;
  tipo_atto: string;
  numero_atto: string;
  data: string;
  articles: string[];
}

export function computeNormaGroups(items: DossierItem[]): NormaGroup[] {
  const groups = new Map<string, NormaGroup>();
  items
    .filter((i) => i.type === 'norma')
    .forEach((item) => {
      const key = `${item.data.tipo_atto}|${item.data.numero_atto || ''}|${item.data.data || ''}`;
      const existing = groups.get(key);
      if (existing) {
        existing.articles.push(item.data.numero_articolo);
      } else {
        groups.set(key, {
          key,
          tipo_atto: item.data.tipo_atto,
          numero_atto: item.data.numero_atto || '',
          data: item.data.data || '',
          articles: [item.data.numero_articolo],
        });
      }
    });
  return Array.from(groups.values());
}

// Map a stored NormaVisitata back to the SearchParams shape triggerSearch()
// expects. Honors the stored version/version_date: a dossier can hold a
// historical text and the reader must not silently swap it for the current one.
export function searchParamsFromNorma(norma: NormaVisitata): SearchParams {
  return {
    act_type: norma.tipo_atto,
    act_number: norma.numero_atto || '',
    date: norma.data || '',
    article: norma.numero_articolo?.toString() || '',
    version: (norma.versione as SearchParams['version']) || 'vigente',
    version_date: norma.data_versione || '',
    show_brocardi_info: true,
    ...(norma.allegato ? { annex: norma.allegato } : {}),
  };
}

interface DossierMeta { important?: boolean }

// Dossier items don't have their own status-storage column server-side for
// arbitrary payloads, so "important" is packed into the item's `data` blob
// under a private `_dossierMeta` key. Note items (plain strings) pass through
// untouched — packing only applies to object payloads (norma items).
export function packItemContent(data: unknown, status?: DossierItem['status']): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const rest: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  delete rest._dossierMeta;
  return status === 'important' ? { ...rest, _dossierMeta: { important: true } } : rest;
}

export function unpackItemContent(content: unknown): { data: unknown; status?: 'important' } {
  if (typeof content !== 'object' || content === null) return { data: content };
  const { _dossierMeta, ...rest } = content as Record<string, unknown> & { _dossierMeta?: DossierMeta };
  return _dossierMeta?.important ? { data: rest, status: 'important' } : { data: rest };
}

export function computeItemCounts(items: DossierItem[]): { norme: number; note: number; important: number } {
  let norme = 0, note = 0, important = 0;
  for (const i of items) {
    if (i.type === 'norma') norme++; else note++;
    if (i.status === 'important') important++;
  }
  return { norme, note, important };
}

// Most recent activity on a dossier: the max of its creation time and every
// item's addedAt. Used to sort dossier lists by recency.
export function dossierRecency(d: Dossier): number {
  const times = [d.createdAt, ...d.items.map(i => i.addedAt)]
    .map(t => new Date(t).getTime())
    .filter(Number.isFinite);
  return times.length ? Math.max(...times) : 0;
}

// Whether a dossier already holds the given article, matching on act
// (tipo_atto + numero_atto + data) and normalized article id so "1-bis" /
// "1 bis" formatting differences between the tree API and the scraper don't
// produce false negatives (see findArticleByNormalizedId in articleIds.ts
// for the same tolerance applied to article lookups).
export function dossierContainsArticle(dossier: Dossier, norma: NormaVisitata): boolean {
  const target = normalizeArticleId(uniqueArticleIdFromNorma(norma));
  return dossier.items.some((i) => {
    if (i.type !== 'norma') return false;
    const d = i.data as NormaVisitata;
    return d.tipo_atto === norma.tipo_atto
      && (d.numero_atto || '') === (norma.numero_atto || '')
      && (d.data || '') === (norma.data || '')
      && normalizeArticleId(uniqueArticleIdFromNorma(d)) === target;
  });
}
