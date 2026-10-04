import { formatDateItalianLong } from '../../../utils/dateUtils';
import { normalizeArticleId } from '../../../utils/treeUtils';
import { uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { requestIsHistorical, versionKey, versionTabSuffix } from '../../../utils/versionDisplay';
import type { ArticleData, Dossier, DossierItem, DossierNormaData, Norma, NormaVisitata, SearchParams } from '../../../types';
import type { DossierItemApi } from '../../../services/dossierService';

// Legacy 4-value status union kept for data + type compat with older dossier
// items (server payloads and `AddItemsDialog` still reference the full type).
// The UI now only ever writes/reads 'unread' | 'important' (see the amber
// star in DossierArticleRow) — 'reading' and 'done' are inert leftovers.
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

// One group = one norm (tipo + numero + data) in one version and one annex, and all its
// articles in the dossier. Two versions of one article are two groups, never "1284,1284";
// nor are art. 1 of annex A and art. 1 of the body of the same decree one request "1,1".
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
  // The stored version of the group's articles ('' when absent): what a search for the group must ask.
  versione: string;
  data_versione: string;
  // The stored annex of the group's articles ('' when absent): what a search for the group must ask.
  allegato: string;
}

export function computeNormaGroups(items: DossierItem[]): NormaGroup[] {
  const groups = new Map<string, NormaGroup>();
  items
    .filter((i) => i.type === 'norma')
    .forEach((item) => {
      const key = `${item.data.tipo_atto}|${item.data.numero_atto || ''}|${item.data.data || ''}|${versionKey(item.data)}|${item.data.allegato || ''}`;
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
          versione: item.data.versione || '',
          data_versione: item.data.data_versione || '',
          allegato: item.data.allegato || '',
        });
      }
    });
  return Array.from(groups.values());
}

// The search that opens a group on the dashboard: the version the group holds,
// and Brocardi only for the text in force (its commentary carries no date).
export function searchParamsFromGroup(group: NormaGroup): SearchParams {
  return {
    act_type: group.tipo_atto,
    act_number: group.numero_atto,
    date: group.data,
    article: group.articles.join(','),
    version: (group.versione as SearchParams['version']) || 'vigente',
    version_date: group.data_versione || '',
    show_brocardi_info: !requestIsHistorical({ versione: group.versione, data_versione: group.data_versione }),
    ...(group.allegato ? { annex: group.allegato } : {}),
  };
}

// The tab a group opens in: the dossier's own for the texts in force, and for a
// group asking for a past text a tab of its own, named as the tabs of the "Testo
// alla data" dialog are. A past text must not sit among the texts in force.
export function tabLabelForGroup(dossierTitle: string, group: NormaGroup): string {
  return requestIsHistorical(group)
    ? `${dossierTitle}${versionTabSuffix({ version: group.versione, versionDate: group.data_versione })}`
    : dossierTitle;
}

// One search per group, each routed to the tab it belongs to (`createTab` makes a
// tab and returns its id). The texts in force share the dossier's tab, created
// only when there is one to put in it; every past group gets a tab of its own.
export function searchesForGroups(
  dossierTitle: string,
  groups: NormaGroup[],
  createTab: (label: string) => string,
): SearchParams[] {
  let sharedTabId: string | undefined;
  return groups.map((group) => {
    const tabLabel = tabLabelForGroup(dossierTitle, group);
    let targetTabId: string;
    if (requestIsHistorical(group)) {
      targetTabId = createTab(tabLabel);
    } else {
      sharedTabId ??= createTab(tabLabel);
      targetTabId = sharedTabId;
    }
    return { ...searchParamsFromGroup(group), tabLabel, targetTabId };
  });
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
    // Brocardi's commentary carries no date: a past text is read without it.
    show_brocardi_info: !requestIsHistorical(norma),
    ...(norma.allegato ? { annex: norma.allegato } : {}),
  };
}

// What the window header's "Aggiungi a dossier" stores for one article of a tab.
// It rebuilds the item from the block's norma and the article, and used to drop
// the version: a historical text was saved under the same label as the current
// one and reopened as the text in force.
export function normaForDossier(norma: Norma, article: ArticleData): NormaVisitata {
  const { versione, data_versione } = article.norma_data;
  return {
    tipo_atto: norma.tipo_atto,
    numero_atto: norma.numero_atto,
    data: norma.data,
    numero_articolo: article.norma_data.numero_articolo,
    urn: norma.urn,
    // The annex is part of the item's key and id: without it the item is not the article the tab shows.
    ...(article.norma_data.allegato ? { allegato: article.norma_data.allegato } : {}),
    ...(versione ? { versione } : {}),
    ...(data_versione ? { data_versione } : {}),
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

type ServerFields = Pick<DossierItem, 'citation' | 'actCitation' | 'aboutItemId' | 'createdBy'>;

// What only the server says about an item (its names, the article a note is
// about, who wrote it), copied only when it said it: an answer from an older
// server leaves the fields absent, and the page falls back.
export function serverFieldsFromApi(
  api: Pick<DossierItemApi, 'citation' | 'act_citation' | 'about_item_id' | 'created_by'>,
): ServerFields {
  return {
    ...(api.citation !== undefined ? { citation: api.citation } : {}),
    ...(api.act_citation !== undefined ? { actCitation: api.act_citation } : {}),
    ...(api.about_item_id !== undefined ? { aboutItemId: api.about_item_id } : {}),
    ...(api.created_by !== undefined ? { createdBy: api.created_by } : {}),
  };
}

// One server item as the store holds it. The star travels inside `content` as a
// _dossierMeta envelope (packItemContent); the DB `status` column is not read.
export function dossierItemFromApi(api: DossierItemApi): DossierItem {
  const { data, status } = unpackItemContent(api.content);
  const base = { id: api.id, addedAt: api.created_at, ...(status ? { status } : {}), ...serverFieldsFromApi(api) };
  return api.item_type === 'norm'
    ? { ...base, type: 'norma', data: data as DossierNormaData }
    : { ...base, type: 'note', data: data as string };
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

// The text two items hold is the same text only when the version agrees too.
// An item saved before versions were kept has no version fields and is the text
// in force, as is one that says "vigente" with no date.
function sameVersion(a: NormaVisitata, b: NormaVisitata): boolean {
  return versionKey(a) === versionKey(b);
}

// Whether a dossier already holds the given article, matching on act
// (tipo_atto + numero_atto + data), normalized article id and version, so
// "1-bis" / "1 bis" formatting differences between the tree API and the
// scraper don't produce false negatives (see findArticleByNormalizedId in
// articleIds.ts for the same tolerance applied to article lookups) and two
// versions of one article can sit side by side.
export function dossierContainsArticle(dossier: Dossier, norma: NormaVisitata): boolean {
  const target = normalizeArticleId(uniqueArticleIdFromNorma(norma));
  return dossier.items.some((i) => {
    if (i.type !== 'norma') return false;
    const d = i.data as NormaVisitata;
    return d.tipo_atto === norma.tipo_atto
      && (d.numero_atto || '') === (norma.numero_atto || '')
      && (d.data || '') === (norma.data || '')
      && normalizeArticleId(uniqueArticleIdFromNorma(d)) === target
      && sameVersion(d, norma);
  });
}
