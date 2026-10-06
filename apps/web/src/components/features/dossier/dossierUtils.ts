import { formatDateItalianLong } from '../../../utils/dateUtils';
import { normalizeArticleId } from '../../../utils/treeUtils';
import { uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { requestIsHistorical, versionKey, versionTabSuffix } from '../../../utils/versionDisplay';
import type { ArticleData, Dossier, DossierItem, DossierNormaData, Norma, NormaVisitata, SearchParams } from '../../../types';
import { v4 as uuidv4 } from 'uuid';
import type { DossierApi, DossierItemApi } from '../../../services/dossierService';
import type { DecisionArchive, DecisionAttributes, DecisionIdentity, DossierSentenzaData } from '../../../types/decisions';
import { decisionKey, formatDecisionCitation, identityOf } from '../../../utils/decisionLinks';
import { rebuildNormEntry } from '../../../utils/sources';

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

export function assertNever(value: never): never {
  throw new Error(`Unexpected dossier item: ${JSON.stringify(value)}`);
}

const SENTENZA_KEYS = new Set(['corte', 'numero', 'anno', 'archivio', 'sezione', 'tipo', 'data_deposito', 'etichetta']);
const SEZIONI = new Set(['1', '2', '3', '4', '5', '6', '7', 'L', 'U', 'F']);
const TIPI = new Set(['sentenza', 'ordinanza', 'ordinanza interlocutoria', 'decreto']);

/** The content of a `sentenza` item, or null. Mirrors apps/server/src/schemas/decisionItem.ts:
 *  change both together. Imported and stored content is untrusted. */
export function parseSentenzaContent(data: unknown, now: Date = new Date()): DossierSentenzaData | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (Object.keys(d).some((k) => !SENTENZA_KEYS.has(k))) return null;
  const { corte, numero, anno, archivio, sezione, tipo, data_deposito, etichetta } = d;
  if (corte !== 'cassazione' && corte !== 'corte_costituzionale') return null;
  if (typeof numero !== 'number' || !Number.isInteger(numero) || numero < 1 || numero > 999_999) return null;
  const first = corte === 'corte_costituzionale' ? 1956 : 1900;
  if (typeof anno !== 'number' || !Number.isInteger(anno) || anno < first || anno > now.getFullYear()) return null;
  if (typeof etichetta !== 'string' || !etichetta.trim() || etichetta.length > 200) return null;
  if (corte === 'cassazione' && archivio !== 'civile' && archivio !== 'penale') return null;
  if (corte === 'corte_costituzionale' && (archivio !== undefined || sezione !== undefined)) return null;
  if (sezione !== undefined && !(typeof sezione === 'string' && SEZIONI.has(sezione))) return null;
  if (tipo !== undefined && !(typeof tipo === 'string' && TIPI.has(tipo))) return null;
  if (data_deposito !== undefined && !(typeof data_deposito === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(data_deposito))) return null;
  return {
    corte,
    numero,
    anno,
    ...(archivio ? { archivio: archivio as DecisionArchive } : {}),
    ...(sezione ? { sezione: sezione as string } : {}),
    ...(tipo ? { tipo: tipo as string } : {}),
    ...(data_deposito ? { data_deposito: data_deposito as string } : {}),
    etichetta,
  };
}

/**
 * A kept decision's citation, recomputed from its identity and attributes (source convention
 * §8.3, Q9). The stored `etichetta` is a convenience copy: the app shows this, and writes this as
 * `etichetta` whenever it writes the item (`itemContentFor`, `serverItemFor`).
 */
export function decisionCitationOf(data: Omit<DossierSentenzaData, 'etichetta'>): string {
  return formatDecisionCitation(identityOf(data), {
    ...(data.sezione ? { sezione: data.sezione } : {}),
    ...(data.tipo ? { tipo: data.tipo } : {}),
    ...(data.data_deposito ? { data_deposito: data.data_deposito } : {}),
  });
}

/** The item a decision page adds: its identity, the attributes the item schema accepts, and the
 *  citation computed from those, so that a later write recomputes the same label. */
export function sentenzaFromDecision(identity: DecisionIdentity, attrs: DecisionAttributes): DossierSentenzaData {
  const kept = {
    corte: identity.corte,
    numero: identity.numero,
    anno: identity.anno,
    ...(identity.archivio ? { archivio: identity.archivio } : {}),
    ...(attrs.sezione && SEZIONI.has(attrs.sezione) && identity.corte === 'cassazione' ? { sezione: attrs.sezione } : {}),
    ...(attrs.tipo && TIPI.has(attrs.tipo) ? { tipo: attrs.tipo } : {}),
    ...(attrs.data_deposito && /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(attrs.data_deposito) ? { data_deposito: attrs.data_deposito } : {}),
  };
  return { ...kept, etichetta: decisionCitationOf(kept) };
}

/** The server's type and title for an item; a decision's title is its recomputed citation (Q9). */
export function serverItemFor(item: DossierItem): { itemType: 'norm' | 'note' | 'sentenza'; title: string } {
  switch (item.type) {
    case 'norma':
      return { itemType: 'norm', title: item.data.tipo_atto || 'Norma' };
    case 'sentenza':
      return { itemType: 'sentenza', title: decisionCitationOf(item.data) };
    case 'note':
      return { itemType: 'note', title: 'Nota' };
    default:
      return assertNever(item);
  }
}

/** The content the app writes for an item: the star in its envelope, and a decision's label
 *  recomputed (Q9), whatever copy it was read with. */
export function itemContentFor(item: DossierItem, status: DossierItem['status'] = item.status): unknown {
  const data = item.type === 'sentenza' ? { ...item.data, etichetta: decisionCitationOf(item.data) } : item.data;
  return packItemContent(data, status);
}

// One server item as the store holds it. The star travels inside `content` as a
// _dossierMeta envelope (packItemContent); the DB `status` column is not read.
export function dossierItemFromApi(api: DossierItemApi): DossierItem {
  const { data, status } = unpackItemContent(api.content);
  const base = { id: api.id, addedAt: api.created_at, ...(status ? { status } : {}), ...serverFieldsFromApi(api) };
  if (api.item_type === 'norm') {
    // A Forum suggestion taken before 2026-10 stored the whole entry: {articleRef, status}.
    const entry = data as { articleRef?: unknown } | null;
    const norma = entry && typeof entry === 'object' && entry.articleRef ? entry.articleRef : data;
    return { ...base, type: 'norma', data: norma as DossierNormaData };
  }
  if (api.item_type === 'sentenza') {
    const sentenza = parseSentenzaContent(data);
    if (sentenza) return { ...base, type: 'sentenza', data: sentenza };
    console.error('Dossier item of type sentenza with unreadable content', { id: api.id });
    return { ...base, type: 'note', data: 'Sentenza non leggibile: i dati salvati sono incompleti.' };
  }
  // 'note' and the unused 'section'; a note taken from a Forum suggestion before 2026-10 was {note}
  const entry = data as { note?: unknown } | null;
  const text = typeof data === 'string' ? data
    : entry && typeof entry === 'object' && typeof entry.note === 'string' ? entry.note : '';
  return { ...base, type: 'note', data: text };
}

export interface ImportCheck {
  dossier: Dossier;
  discarded: Array<{ index: number; reason: string }>;
}

/**
 * A dossier from someone else — a shared environment, a share link, a JSON file — its items
 * rebuilt before they are imported: a decision through `parseSentenzaContent` with its label
 * recomputed (design 2026-10-01 §6; the server checks it again), a norm through
 * `rebuildNormEntry` (a known act type, closed forms: no text its author wrote reaches a
 * citation). An item that cannot be imported is listed with the reason and counted in the toast,
 * never dropped in silence. A note is imported as it is: its text is never in a citation.
 */
export function validateImportedDossier(raw: unknown): ImportCheck | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as { title?: unknown; items?: unknown };
  if (typeof candidate.title !== 'string' || candidate.title.trim() === '' || !Array.isArray(candidate.items)) return null;
  const items: DossierItem[] = [];
  const discarded: ImportCheck['discarded'] = [];
  candidate.items.forEach((entry, index) => {
    const item = entry as { id?: unknown; type?: unknown; data?: unknown; addedAt?: unknown; status?: unknown } | null;
    if (item?.type === 'sentenza') {
      const data = parseSentenzaContent(item.data);
      if (data) {
        // Rebuilt from whitelisted fields, never spread: the entry is untrusted. The stored label is
        // the citation recomputed, never an incoming one (source convention, Q9).
        items.push({
          id: typeof item.id === 'string' && item.id ? item.id : uuidv4(),
          type: 'sentenza',
          data: { ...data, etichetta: decisionCitationOf(data) },
          addedAt: typeof item.addedAt === 'string' && item.addedAt ? item.addedAt : new Date().toISOString(),
          ...(item.status === 'important' ? { status: 'important' as const } : {}),
        });
      } else discarded.push({ index, reason: 'sentenza con dati non validi' });
    } else if (item?.type === 'norma') {
      // A norm from someone else's dossier is cited to its new owner (here, and in the MCP
      // deletion dialog): rebuilt from closed values, or left out and counted (utils/sources).
      const norm = rebuildNormEntry(item.data);
      if (norm.ok) {
        items.push({
          id: typeof item.id === 'string' && item.id ? item.id : uuidv4(),
          type: 'norma',
          data: { data: '', ...norm.entry },
          addedAt: typeof item.addedAt === 'string' && item.addedAt ? item.addedAt : new Date().toISOString(),
          ...(item.status === 'important' ? { status: 'important' as const } : {}),
        });
      } else discarded.push({ index, reason: norm.reason });
    } else if (item?.type === 'note') {
      items.push(entry as DossierItem);
    } else {
      discarded.push({ index, reason: 'tipo di voce sconosciuto' });
    }
  });
  // Dossier-level fields are untrusted too: a description that is not a string and tags that are not
  // a list of strings are dropped.
  const { description, tags, ...rest } = raw as Dossier;
  return {
    dossier: {
      ...rest,
      items,
      ...(typeof description === 'string' ? { description } : {}),
      ...(Array.isArray(tags) && tags.every((t) => typeof t === 'string') ? { tags } : {}),
    },
    discarded,
  };
}

/** The toast's type after an import: whole, partial, or nothing came in. */
export function importToastType(imported: number, lost: number): 'success' | 'info' | 'warning' {
  if (lost === 0) return 'success';
  return imported === 0 ? 'warning' : 'info';
}

/** «1 voce importata, 1 scartata»: the counts of a partial import. */
export function importCounts(imported: number, lost: number): string {
  return `${imported} ${imported === 1 ? 'voce importata' : 'voci importate'}, ${lost} ${lost === 1 ? 'scartata' : 'scartate'}`;
}

/** Why items were left out, after the counts: the first reason, and how many others («… e altri 2 motivi»). */
export function importReasonsText(reasons: string[]): string {
  if (reasons.length === 0) return '';
  const others = reasons.length - 1;
  return ` — ${reasons[0]}${others > 0 ? ` e ${others === 1 ? 'un altro motivo' : `altri ${others} motivi`}` : ''}`;
}

/** The toast after an import: whole, or how many items were left out (not importable, or refused by the server). */
export function importReport(imported: number, lost: number): string {
  if (lost === 0) return 'Dossier importato';
  return `Dossier importato in parte: ${importCounts(imported, lost)}`;
}

/** A dossier as a Forum suggestion carries it; the server makes each entry the item it stands for.
 *  A decision travels with its citation recomputed (source convention, Q9). */
export function dossierSuggestionPayload(d: Dossier) {
  return {
    title: d.title,
    description: d.description,
    tags: d.tags ?? [],
    entries: d.items.map((it) => ({
      articleRef: it.type === 'norma' ? it.data : undefined,
      sentenzaRef: it.type === 'sentenza' ? { ...it.data, etichetta: decisionCitationOf(it.data) } : undefined,
      note: it.type === 'note' ? it.data : undefined,
      status: it.status,
    })),
  };
}

export function dossierContainsDecision(dossier: Dossier, identity: DecisionIdentity): boolean {
  const key = decisionKey(identity);
  return dossier.items.some((i) => i.type === 'sentenza' && decisionKey(i.data) === key);
}

/** One server dossier as the store holds it. */
export function dossierFromApi(d: DossierApi): Dossier {
  return {
    id: d.id,
    title: d.name,
    description: d.description || undefined,
    createdAt: d.created_at,
    items: d.items.map(dossierItemFromApi),
    tags: d.tags ?? [],
    isPinned: d.is_pinned,
  };
}

/** «scritta da Claude Code (applicazione collegata)»: who wrote an entry, on screen (`ClaudeMark`) and in the PDF. */
export function claudeMarkSentence(createdBy: NonNullable<DossierItem['createdBy']>): string {
  const name = createdBy.clientName?.trim();
  return name ? `scritta da ${name} (applicazione collegata)` : "scritta da un'applicazione collegata";
}

export function computeItemCounts(items: DossierItem[]): { norme: number; sentenze: number; note: number; important: number } {
  let norme = 0;
  let sentenze = 0;
  let note = 0;
  let important = 0;
  for (const i of items) {
    switch (i.type) {
      case 'norma': norme++; break;
      case 'sentenza': sentenze++; break;
      case 'note': note++; break;
      default: assertNever(i);
    }
    if (i.status === 'important') important++;
  }
  return { norme, sentenze, note, important };
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
