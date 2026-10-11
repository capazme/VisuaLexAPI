import type { ArticleData, Norma } from '../types';
import type { DecisionCourt, DecisionReference, DecisionSearchQuery } from '../types/decisions';
import { actKeyOf, compareArticles, shownAnnex } from '../components/features/dossier/dossierLayout';
import { findArticleByNormalizedId } from './articleIds';
import { formatDecisionShort } from './decisionLinks';
import { buildItemKey } from './normaKeys';
import { requestIsHistorical, versionKey } from './versionDisplay';

/**
 * The practice: the table of a question, which replaces the workspace tab (spec
 * `2026-10-08-norm-tab-container-design.md` §2, T1). Pure: the types and every rule,
 * tested without a DOM; the store holds the state and calls these. Nothing here
 * imports the store.
 */

/** One practice: the table of a question. UI state, saved in the browser (D6). */
export interface Practice {
  id: string;
  label: string;
  /** The user named it (rename, a dossier's «Apri tutto»): searches never rename it. */
  labelIsCustom: boolean;
  /** In order of arrival; reordered by drag (D8). */
  acts: PracticeAct[];
  /** «Giurisprudenza»: stored in order of arrival, shown by `decisionOrder` (T7). */
  decisions: PracticeDecision[];
  /** The light windows beside the table on the desktop, oldest first, at most two (D10, T14). */
  beside: BesideRef[];
}

export interface PracticeAct {
  /** Stable: owns the structure window and names the act in back-stack entries. */
  id: string;
  /** `actKeyOf(norma)` (dossierLayout.ts): a code by its name, any other act by type, number, date. */
  key: string;
  /** The act as the first search or the index resolved it; carries the act-level URN. */
  norma: Norma;
  /** Sorted by `compareArticles(a.norma_data, b.norma_data)`; unique by `practiceArticleKey` (T2). */
  articles: ArticleData[];
  isCollapsed: boolean;
}

export interface PracticeDecision {
  id: string;
  /** The citation as asked; replaced by the identity once found (as `setDecisionTabIdentity` does). */
  reference: DecisionReference;
  /** `formatDecisionShort`, with the section once known. */
  label: string;
  /** The reference is the decision's identity: set on a found answer, never guessed. */
  identified: boolean;
  /** `attributi.data_deposito`, ISO, once found (T7). */
  depositDate?: string;
  /** `attributi.tipo`, kept for «Salva come dossier». */
  tipo?: string;
  /** The `decisionKey` this entry's reading recorded in the Cronologia: once per opening (PR 5). */
  historyRecordedKey?: string;
}

/** What a light window shows. `id` is stable for the subject, so opening it twice finds it. */
export type BesideRef =
  | { id: string; kind: 'article'; actId: string; articleKey: string }
  | { id: string; kind: 'decision'; decisionId: string }
  | { id: string; kind: 'decision-search'; query: DecisionSearchQuery; label: string };

/** At most two windows beside the table (D10). */
export const MAX_BESIDE = 2;

/**
 * An article's identity in a practice: its annotation key plus the text it asks for (T2).
 * Keyed on `norma_data`, not `versionInfo`: the server echoes the request's `versione` and
 * `data_versione` into every article's `norma_data` (`NormaVisitata.to_dict`), and it travels
 * with the article everywhere (dossier, find window, fetch cache), while `versionInfo` is set
 * only by the search page's `processResult`.
 */
export function practiceArticleKey(article: ArticleData): string {
  return `${buildItemKey(article.norma_data)}|${versionKey(article.norma_data)}`;
}

/** The key of an article's row in the store's open rows and reveal (T15): `practiceId/actId/articleKey`. */
export function articleRowKey(practiceId: string, actId: string, articleKey: string): string {
  return `${practiceId}/${actId}/${articleKey}`;
}

/** The key of a decision's row: `practiceId/decisionId`. */
export function decisionRowKey(practiceId: string, decisionId: string): string {
  return `${practiceId}/${decisionId}`;
}

const ANNEX_PREFIX = /^all([^:]+):(.+)$/;

// An article as a row of its act shows it: a code's annex («2» of the R.D.) is dropped.
function asShown(article: ArticleData): ArticleData {
  return { ...article, norma_data: { ...article.norma_data, allegato: shownAnnex(article.norma_data) || undefined } };
}

/**
 * The row of `act` holding the article `articleId` names (an index pick, an arrow, a citation, a
 * back-stack entry): `findArticleByNormalizedId` over the rows (gotcha 9), a code's annex compared
 * through `shownAnnex`; the text in force before a past text.
 */
export function findPracticeArticle(act: PracticeAct, articleId: string): ArticleData | undefined {
  if (!articleId) return undefined;
  const prefixed = ANNEX_PREFIX.exec(articleId.trim());
  const annex = prefixed ? shownAnnex({ tipo_atto: act.norma.tipo_atto, allegato: prefixed[1] }) : '';
  const numero = prefixed ? prefixed[2] : articleId;
  const wanted = annex ? `all${annex}:${numero}` : numero;
  const pick = (rows: ArticleData[]): ArticleData | undefined => {
    const shown = rows.map(asShown);
    const hit = findArticleByNormalizedId(shown, wanted);
    return hit ? rows[shown.indexOf(hit)] : undefined;
  };
  return pick(act.articles.filter((a) => !requestIsHistorical(a.norma_data))) ?? pick(act.articles);
}

/**
 * Adds `articles` of `norma` to the act they belong to (`actKeyOf`), appending the act when the
 * practice has none. A copy whose `practiceArticleKey` is already there is one row: it fills the
 * Brocardi the stored row lacks and the act's URN, never the stored `norma_data` (T2). The input
 * is not changed; untouched acts keep their identity.
 */
export function addArticles(
  acts: PracticeAct[],
  norma: Norma,
  articles: ArticleData[],
  newId: () => string,
): { acts: PracticeAct[]; actId: string; added: string[] } {
  const key = actKeyOf(norma);
  const index = acts.findIndex((a) => a.key === key);
  const act: PracticeAct = index >= 0
    ? { ...acts[index], norma: { ...acts[index].norma }, articles: [...acts[index].articles] }
    : { id: newId(), key, norma: { ...norma }, articles: [], isCollapsed: false };
  if (!act.norma.urn && norma.urn) act.norma.urn = norma.urn;

  const added: string[] = [];
  for (const incoming of articles) {
    const articleKey = practiceArticleKey(incoming);
    const at = act.articles.findIndex((a) => practiceArticleKey(a) === articleKey);
    if (at < 0) {
      act.articles.push(incoming);
      added.push(articleKey);
      continue;
    }
    const stored = act.articles[at];
    if (incoming.brocardi_info && !stored.brocardi_info) {
      const filled: ArticleData = { ...stored, brocardi_info: incoming.brocardi_info };
      delete filled.brocardi_error;
      act.articles[at] = filled;
    }
  }
  // Array.prototype.sort is stable: copies that rank alike keep their order of arrival.
  act.articles.sort((a, b) => compareArticles(a.norma_data, b.norma_data));

  const next = index >= 0 ? acts.map((a, i) => (i === index ? act : a)) : [...acts, act];
  return { acts: next, actId: act.id, added };
}

/** Does the entry's reference (`entry`) show the decision a citation (`wanted`) names? Same court,
 *  number and year; a citation with an archive matches only an entry of that archive (civil and
 *  penal numbers run in separate series), one without matches an entry of either. */
export function sameDecision(entry: DecisionReference, wanted: DecisionReference): boolean {
  return entry.corte === wanted.corte && entry.numero === wanted.numero && entry.anno === wanted.anno &&
    (wanted.archivio === undefined || entry.archivio === wanted.archivio);
}

// The day of deposit when known, else the year: as strings, so a year sorts with its days.
const decisionWhen = (d: PracticeDecision): string => d.depositDate || String(d.reference.anno);

/** «Giurisprudenza» as shown: newest first, by the day of deposit when known, else by the year;
 *  ties by number, the higher first (T7). Returns a new array. */
export function decisionOrder(decisions: PracticeDecision[]): PracticeDecision[] {
  return [...decisions].sort((a, b) => {
    const when = decisionWhen(b).localeCompare(decisionWhen(a));
    return when !== 0 ? when : b.reference.numero - a.reference.numero;
  });
}

/**
 * The windows after `ref` is opened beside (D10, T16): nothing moves when it is already there;
 * under two, it is appended on the right; with two, the oldest window that is not the one the
 * link was clicked in (`askerId`) goes, and its subject stays in the table.
 */
export function besideAfterOpen(beside: BesideRef[], ref: BesideRef, askerId?: string): BesideRef[] {
  if (beside.some((b) => b.id === ref.id)) return beside;
  const kept = [...beside];
  while (kept.length >= MAX_BESIDE) {
    const oldest = kept.findIndex((b) => b.id !== askerId);
    if (oldest < 0) break;
    kept.splice(oldest, 1);
  }
  return [...kept, ref];
}

export interface PracticeCounts {
  acts: number;
  articles: number;
  decisions: number;
}

export function practiceCounts(p: Practice): PracticeCounts {
  return {
    acts: p.acts.length,
    articles: p.acts.reduce((sum, act) => sum + act.articles.length, 0),
    decisions: p.decisions.length,
  };
}

/** «2 atti · 4 articoli · 2 sentenze»: what is there, empty parts left out. */
export function practiceCountLine(counts: PracticeCounts): string {
  const part = (n: number, one: string, many: string) => (n > 0 ? `${n} ${n === 1 ? one : many}` : null);
  return [
    part(counts.acts, 'atto', 'atti'),
    part(counts.articles, 'articolo', 'articoli'),
    part(counts.decisions, 'sentenza', 'sentenze'),
  ].filter(Boolean).join(' · ');
}

// --- Saved state is untrusted input (spec §10): checked before use, never thrown on. ---

/** A practice's name as stored and shown: trimmed, at most this long (spec §10). */
export const MAX_PRACTICE_LABEL = 120;

export function practiceLabel(label: string): string {
  return label.trim().slice(0, MAX_PRACTICE_LABEL);
}

/** The name of a practice whose saved name is empty. */
export const DEFAULT_PRACTICE_LABEL = 'Pratica';
/** The name of a topic-search window whose saved label is empty. */
export const DEFAULT_SEARCH_LABEL = 'Ricerca per tema';

/** A saved label as stored and shown (`practiceLabel`), or `fallback` when nothing is left of it. */
export function labelOr(label: unknown, fallback: string): string {
  const kept = typeof label === 'string' ? practiceLabel(label) : '';
  return kept || practiceLabel(fallback);
}

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose => !!value && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const shapeOf = (value: unknown): string => {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'an object' : `${typeof value} ${JSON.stringify(value).slice(0, 40)}`;
};

/** A saved view of a tab (a decision or a topic search) that can be read: a court, a positive
 *  integer number and year; a topic or a norm with its act type and article. */
export function isValidView(view: unknown): boolean {
  if (!view || typeof view !== 'object') return false;
  const v = view as { kind?: unknown; reference?: Record<string, unknown>; query?: unknown };
  if (v.kind === 'decision') {
    const r = v.reference;
    return !!r && typeof r.corte === 'string' && r.corte !== '' &&
      Number.isInteger(r.numero) && (r.numero as number) > 0 &&
      Number.isInteger(r.anno) && (r.anno as number) > 0;
  }
  if (v.kind === 'decision-search') {
    const q = v.query as { tema?: unknown; norma?: unknown } | null | undefined;
    if (!q || typeof q !== 'object') return false;
    if (q.tema !== undefined && typeof q.tema !== 'string') return false;
    const n = q.norma as Record<string, unknown> | null | undefined;
    if (n !== undefined && (!n || typeof n !== 'object' || typeof n.tipo_atto !== 'string' || typeof n.numero_articolo !== 'string')) return false;
    return q.tema !== undefined || n !== undefined;
  }
  return false;
}

// The fields of a `norma_data` the keys and the sort read with string methods, when present.
const NORMA_TEXT_FIELDS = ['data', 'numero_atto', 'tipo_atto_reale', 'allegato', 'versione', 'data_versione', 'urn'] as const;

/** An article that can be keyed, sorted and drawn: a `norma_data` with its act type and article
 *  number, its other fields text when present, and its text, when it has one, as text. */
export function isStoredArticle(value: unknown): value is ArticleData {
  if (!isObject(value) || !isObject(value.norma_data)) return false;
  if (value.article_text !== undefined && !isText(value.article_text)) return false;
  const norma = value.norma_data;
  return isText(norma.tipo_atto) && isText(norma.numero_articolo) &&
    NORMA_TEXT_FIELDS.every((field) => norma[field] === undefined || norma[field] === null || isText(norma[field]));
}

/** A topic search's query that can be run and drawn: `isValidView`'s checks, and its norm's label,
 *  when it has one, as text. */
export function isStoredQuery(value: unknown): value is DecisionSearchQuery {
  if (!isValidView({ kind: 'decision-search', query: value })) return false;
  const label = (value as { normaLabel?: unknown }).normaLabel;
  return label === undefined || isText(label);
}

/** An act as stored: its type required, the other fields kept only when they are text. */
export function storedNorma(value: unknown): Norma | null {
  if (!isObject(value) || !isText(value.tipo_atto) || value.tipo_atto.trim() === '') return null;
  const norma: Norma = { tipo_atto: value.tipo_atto, data: isText(value.data) ? value.data : '' };
  if (isText(value.numero_atto)) norma.numero_atto = value.numero_atto;
  if (isText(value.tipo_atto_reale)) norma.tipo_atto_reale = value.tipo_atto_reale;
  if (isText(value.urn)) norma.urn = value.urn;
  return norma;
}

const COURTS: readonly DecisionCourt[] = ['cassazione', 'corte_costituzionale'];

/** A decision's reference that passes `isValidView`, of a court VisuaLex reads, with its known
 *  fields only. The migration and `sanitizePractices` both keep this, so it is a fixed point. */
export function storedReference(value: unknown): DecisionReference | null {
  if (!isObject(value) || !isValidView({ kind: 'decision', reference: value })) return null;
  if (!COURTS.includes(value.corte as DecisionCourt)) return null;
  if (value.archivio !== undefined && value.archivio !== 'civile' && value.archivio !== 'penale') return null;
  const reference = { corte: value.corte, numero: value.numero, anno: value.anno } as DecisionReference;
  if (value.archivio !== undefined) reference.archivio = value.archivio as DecisionReference['archivio'];
  if (isText(value.sezione)) reference.sezione = value.sezione;
  return reference;
}

function sanitizeAct(raw: unknown, where: string, dropped: string[]): PracticeAct | null {
  if (!isObject(raw) || !isText(raw.id) || raw.id === '') {
    dropped.push(`${where}: an act without an id (${shapeOf(raw)})`);
    return null;
  }
  const norma = storedNorma(raw.norma);
  if (!norma || !Array.isArray(raw.articles)) {
    dropped.push(`${where}, act ${raw.id}: no act type or no list of articles`);
    return null;
  }
  const articles: ArticleData[] = [];
  const keys = new Set<string>();
  raw.articles.forEach((article: unknown, i: number) => {
    if (!isStoredArticle(article)) {
      dropped.push(`${where}, act ${raw.id}: article #${i} cannot be read: no norma_data, or a field that is not text (${shapeOf(article)})`);
      return;
    }
    const key = practiceArticleKey(article);
    if (keys.has(key)) {
      dropped.push(`${where}, act ${raw.id}: a second copy of ${key}`);
      return;
    }
    keys.add(key);
    articles.push(article);
  });
  return { id: raw.id, key: actKeyOf(norma), norma, articles, isCollapsed: raw.isCollapsed === true };
}

function sanitizeDecision(raw: unknown, where: string, dropped: string[]): PracticeDecision | null {
  const reference = isObject(raw) ? storedReference(raw.reference) : null;
  if (!isObject(raw) || !isText(raw.id) || raw.id === '' || !reference || !isText(raw.label)) {
    dropped.push(`${where}: a decision without an id, a label or a valid reference (${shapeOf(isObject(raw) ? raw.reference : raw)})`);
    return null;
  }
  const decision: PracticeDecision = {
    id: raw.id, reference, label: labelOr(raw.label, formatDecisionShort(reference)), identified: raw.identified === true,
  };
  if (isText(raw.depositDate)) decision.depositDate = raw.depositDate;
  if (isText(raw.tipo)) decision.tipo = raw.tipo;
  if (isText(raw.historyRecordedKey)) decision.historyRecordedKey = raw.historyRecordedKey;
  return decision;
}

/** What a practice's windows name, after any re-id: a saved act id and a saved decision id → the
 *  id each has now. Two maps, since an act and a decision that share a saved id are two things. */
interface SavedIds {
  acts: Map<string, string>;
  decisions: Map<string, string>;
}

/** Two windows on one subject: after the id maps, two decisions (or acts) that merged are one. */
function sameBesideSubject(a: BesideRef, b: BesideRef): boolean {
  if (a.kind === 'article' && b.kind === 'article') return a.actId === b.actId && a.articleKey === b.articleKey;
  if (a.kind === 'decision' && b.kind === 'decision') return a.decisionId === b.decisionId;
  return false;
}

function sanitizeBeside(raw: unknown, practice: Practice, ids: SavedIds): BesideRef | null {
  if (!isObject(raw) || !isText(raw.id) || raw.id === '') return null;
  if (raw.kind === 'article' && isText(raw.actId) && isText(raw.articleKey)) {
    const actId = ids.acts.get(raw.actId);
    const act = practice.acts.find((a) => a.id === actId);
    const held = act?.articles.some((a) => practiceArticleKey(a) === raw.articleKey);
    return act && held ? { id: raw.id, kind: 'article', actId: act.id, articleKey: raw.articleKey } : null;
  }
  if (raw.kind === 'decision' && isText(raw.decisionId)) {
    const decisionId = ids.decisions.get(raw.decisionId);
    return decisionId && practice.decisions.some((d) => d.id === decisionId)
      ? { id: raw.id, kind: 'decision', decisionId }
      : null;
  }
  if (raw.kind === 'decision-search' && isText(raw.label) && isStoredQuery(raw.query)) {
    return { id: raw.id, kind: 'decision-search', query: raw.query, label: labelOr(raw.label, DEFAULT_SEARCH_LABEL) };
  }
  return null;
}

/** Two entries show one decision when every field of their identity is equal (as the migration
 *  reads two tabs). */
export const sameEntry = (a: DecisionReference, b: DecisionReference): boolean =>
  a.corte === b.corte && a.numero === b.numero && a.anno === b.anno && a.archivio === b.archivio;

/**
 * One entry from two entries of one decision (`sameEntry`): the first one's id, and what either
 * holds. An identified entry leads over one that is not (its reference is the identity, its label
 * carries the section); otherwise the first leads. The fields the leader lacks — `depositDate`,
 * `tipo`, `historyRecordedKey` — are taken from the other, so nothing either learned is lost.
 */
export function mergeDecisionEntries(first: PracticeDecision, second: PracticeDecision): PracticeDecision {
  const [lead, other] = !first.identified && second.identified ? [second, first] : [first, second];
  const merged: PracticeDecision = { id: first.id, reference: lead.reference, label: lead.label, identified: lead.identified };
  const depositDate = lead.depositDate ?? other.depositDate;
  const tipo = lead.tipo ?? other.tipo;
  const historyRecordedKey = lead.historyRecordedKey ?? other.historyRecordedKey;
  if (depositDate !== undefined) merged.depositDate = depositDate;
  if (tipo !== undefined) merged.tipo = tipo;
  if (historyRecordedKey !== undefined) merged.historyRecordedKey = historyRecordedKey;
  return merged;
}

/**
 * The saved practices, checked (spec §10): a practice is kept only with a string id and label and
 * lists where lists belong; an act only with an act type, and its articles only with a
 * `norma_data` and a text that is text; a decision only with a reference `storedReference`
 * accepts; a window only when it points at something the practice holds, at most two. A second
 * entry of one decision is merged into the first (`mergeDecisionEntries`). Act and decision ids are
 * unique across practices: a taken one is re-id'd (`<id>-2`, …), and the practice's windows follow
 * it, acts and decisions through separate maps. Labels are trimmed and capped. What fails, and
 * every merge and re-id, goes into `dropped`, for the caller to log (gotcha 18); nothing is
 * thrown, since a throw in the store's `merge` would reset it.
 */
export function sanitizePractices(raw: unknown): { practices: Practice[]; dropped: string[] } {
  const dropped: string[] = [];
  if (raw === undefined || raw === null) return { practices: [], dropped };
  if (!Array.isArray(raw)) return { practices: [], dropped: [`practices: not a list (${shapeOf(raw)})`] };

  const practices: Practice[] = [];
  // Act and decision ids taken so far, across practices.
  const taken = new Set<string>();
  const claim = (id: string): string => {
    let next = id;
    for (let n = 2; taken.has(next); n++) next = `${id}-${n}`;
    taken.add(next);
    return next;
  };

  raw.forEach((entry: unknown, index: number) => {
    if (!isObject(entry) || !isText(entry.id) || entry.id === '' || !isText(entry.label) ||
      !Array.isArray(entry.acts) || !Array.isArray(entry.decisions) || !Array.isArray(entry.beside)) {
      dropped.push(`practice #${index}: no id, no label, or not lists of acts, decisions and windows (${shapeOf(entry)})`);
      return;
    }
    if (practices.some((p) => p.id === entry.id)) {
      dropped.push(`practice #${index}: the id ${entry.id} is already taken`);
      return;
    }
    const where = `practice ${entry.id}`;
    const practice: Practice = {
      id: entry.id, label: labelOr(entry.label, DEFAULT_PRACTICE_LABEL), labelIsCustom: entry.labelIsCustom === true,
      acts: [], decisions: [], beside: [],
    };
    // A saved act or decision id → the id it has now; the first of a practice's equal ids wins.
    const ids: SavedIds = { acts: new Map(), decisions: new Map() };
    const keep = (map: Map<string, string>, saved: string, now: string) => { if (!map.has(saved)) map.set(saved, now); };
    for (const rawAct of entry.acts) {
      const act = sanitizeAct(rawAct, where, dropped);
      if (!act) continue;
      const same = practice.acts.find((a) => a.key === act.key);
      if (same) {
        // Two acts of one identity: one act, the first one's id (no article is lost).
        practice.acts = addArticles(practice.acts, act.norma, act.articles, () => same.id).acts;
        keep(ids.acts, act.id, same.id);
        continue;
      }
      const id = claim(act.id);
      if (id !== act.id) dropped.push(`${where}: the act id ${act.id} is already taken, re-id'd ${id}`);
      keep(ids.acts, act.id, id);
      practice.acts.push({ ...act, id });
    }
    for (const rawDecision of entry.decisions) {
      const decision = sanitizeDecision(rawDecision, where, dropped);
      if (!decision) continue;
      const at = practice.decisions.findIndex((d) => sameEntry(d.reference, decision.reference));
      if (at >= 0) {
        const twin = practice.decisions[at];
        dropped.push(`${where}: a second entry of the decision ${twin.label} (${decision.id}), merged into ${twin.id}`);
        practice.decisions[at] = mergeDecisionEntries(twin, decision);
        keep(ids.decisions, decision.id, twin.id);
        continue;
      }
      const id = claim(decision.id);
      if (id !== decision.id) dropped.push(`${where}: the decision id ${decision.id} is already taken, re-id'd ${id}`);
      keep(ids.decisions, decision.id, id);
      practice.decisions.push({ ...decision, id });
    }
    const beside: BesideRef[] = [];
    for (const rawRef of entry.beside) {
      const ref = sanitizeBeside(rawRef, practice, ids);
      if (!ref || beside.some((b) => b.id === ref.id || sameBesideSubject(b, ref))) {
        dropped.push(`${where}: a window that points at nothing the practice holds (${shapeOf(isObject(rawRef) ? rawRef.kind : rawRef)})`);
        continue;
      }
      beside.push(ref);
    }
    if (beside.length > MAX_BESIDE) dropped.push(`${where}: ${beside.length - MAX_BESIDE} windows past the two allowed`);
    practice.beside = beside.slice(-MAX_BESIDE);
    practices.push(practice);
  });
  return { practices, dropped };
}
