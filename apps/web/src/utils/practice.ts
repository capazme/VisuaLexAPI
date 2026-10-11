import type { ArticleData, Norma } from '../types';
import type { DecisionReference, DecisionSearchQuery } from '../types/decisions';
import { actKeyOf, compareArticles, shownAnnex } from '../components/features/dossier/dossierLayout';
import { buildItemKey } from './normaKeys';
import { normalizeArticleId } from './treeUtils';
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

// An article id as a row of `tipoAtto` shows it: a code's annex («2» of the R.D.) is dropped.
function shownArticleId(tipoAtto: string, allegato: string | undefined, numero: string): string {
  const annex = shownAnnex({ tipo_atto: tipoAtto, allegato });
  return normalizeArticleId(annex ? `all${annex}:${numero}` : numero);
}

const ANNEX_PREFIX = /^all([^:]+):(.+)$/;

/**
 * The row of `act` holding the article `articleId` names (an index pick, an arrow, a citation, a
 * back-stack entry): ids compared through `normalizeArticleId` (gotcha 9), a code's annex through
 * `shownAnnex`; the text in force before a past text.
 */
export function findPracticeArticle(act: PracticeAct, articleId: string): ArticleData | undefined {
  if (!articleId) return undefined;
  const prefixed = ANNEX_PREFIX.exec(articleId.trim());
  const wanted = prefixed
    ? shownArticleId(act.norma.tipo_atto, prefixed[1], prefixed[2])
    : shownArticleId(act.norma.tipo_atto, undefined, articleId);
  const matches = act.articles.filter((a) =>
    shownArticleId(a.norma_data.tipo_atto, a.norma_data.allegato, a.norma_data.numero_articolo) === wanted);
  return matches.find((a) => !requestIsHistorical(a.norma_data)) ?? matches[0];
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
