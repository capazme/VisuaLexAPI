import type { ArticleData, Norma } from '../types';
import type { DecisionSearchQuery } from '../types/decisions';
import { formatDecisionShort } from './decisionLinks';
import {
  addArticles, DEFAULT_PRACTICE_LABEL, DEFAULT_SEARCH_LABEL, isStoredArticle, isStoredQuery, isValidView, labelOr,
  storedNorma, storedReference, type BesideRef, type Practice, type PracticeAct, type PracticeDecision,
} from './practice';

/**
 * From the saved workspace tabs to practices (spec `2026-10-08-norm-tab-container-design.md` §9,
 * D13, T10). Pure and synchronous, never throwing: the store's `merge` calls it on whatever the
 * browser holds. Every article keeps its `norma_data`, so the keys of highlights, notes and
 * discussions are the same after; every decision keeps its reference, so `decisionKey` is too.
 */

// The shapes the store persisted, as far as the migration reads them. Typed loosely on purpose:
// saved state is untrusted, and the tab types themselves retire with this migration.

/** A saved workspace tab. `position` and `size` were persisted too and are dropped; `isMinimized`
 *  and `isHidden` only decide which tab was in front; a decision tab's `historyRecordedKey` is
 *  kept on its entry. */
interface LegacyTab {
  id?: unknown;
  label?: unknown;
  labelIsCustom?: unknown;
  zIndex?: unknown;
  isMinimized?: unknown;
  isHidden?: unknown;
  content?: unknown;
  view?: unknown;
  historyRecordedKey?: unknown;
}

/** A norm block: `{ type: 'norma', id, norma, articles, isCollapsed, autoFocusArticleId? }`. */
interface LegacyNormaBlock {
  type: 'norma';
  id?: unknown;
  norma?: unknown;
  articles?: unknown;
  isCollapsed?: unknown;
}

/** An extracted article: `{ type: 'loose-article', id, article, sourceNorma }`. */
interface LegacyLooseArticle {
  type: 'loose-article';
  article?: unknown;
  sourceNorma?: unknown;
}

/** An article collection, removed from the app; an old browser may still hold one:
 *  `{ type: 'collection', id, label, articles: { article, sourceNorma }[], isCollapsed, color? }`. */
interface LegacyCollection {
  type: 'collection';
  articles?: unknown;
}

type LegacyItem = LegacyNormaBlock | LegacyLooseArticle | LegacyCollection;

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose => !!value && typeof value === 'object' && !Array.isArray(value);

/** The name of a practice made for decisions when no norm tab was open (T10). */
export const DECISIONS_PRACTICE_LABEL = 'Sentenze';

export interface MigratedWorkspace {
  practices: Practice[];
  activePracticeId: string | null;
  /** What did not parse, for the log (gotcha 18). */
  dropped: string[];
  /** The labels of the topic searches not reopened, for the notice (`practiceNoticeText`). */
  droppedSearches: string[];
}

// The act an extracted article belongs to: its saved source, else the act its norma_data names;
// null when neither names an act type.
function actOfArticle(article: ArticleData, sourceNorma: unknown): Norma | null {
  const source = storedNorma(sourceNorma);
  if (source) return source;
  const { tipo_atto, data, numero_atto, tipo_atto_reale } = article.norma_data;
  return storedNorma({ tipo_atto, data, numero_atto, tipo_atto_reale });
}

const zOf = (tab: LegacyTab): number => (typeof tab.zIndex === 'number' && Number.isFinite(tab.zIndex) ? tab.zIndex : -Infinity);
const isVisible = (tab: LegacyTab): boolean => tab.isMinimized !== true && tab.isHidden !== true;

// Is `a` in front of `b`? As PR 4d's `frontTabId` reads it: a visible tab (not minimised, not
// hidden) before any other, then the higher z-index (minimising does not lower it).
const before = (a: LegacyTab, b: LegacyTab): boolean =>
  isVisible(a) !== isVisible(b) ? isVisible(a) : zOf(a) > zOf(b);

// The entry in front; the first of equals (array order is the dock's order). With no visible tab,
// the highest z-index of the others, so the decisions still join a practice the user made.
function front<T extends { tab: LegacyTab }>(entries: T[]): T | undefined {
  return entries.reduce<T | undefined>((best, e) => (!best || before(e.tab, best.tab) ? e : best), undefined);
}

/**
 * Turns the saved tabs into practices (spec §9): each tab without a view is a practice with its
 * id, label and order, its blocks merged into acts by `actKeyOf` (the first block's id kept), its
 * loose articles and a collection's articles into their acts; the decision tabs go under
 * «Giurisprudenza» of the practice whose tab was in front (`before`: visible, then the highest
 * z-index), or of a new practice «Sentenze»; the topic search in front becomes that practice's
 * window, the others are named in `droppedSearches`; that practice is active. References, queries
 * and labels are kept as `sanitizePractices` keeps them, so its output is a fixed point. Ids come
 * from `newId` only where a saved one is missing or taken.
 */
export function practicesFromTabs(tabs: unknown, newId: () => string): MigratedWorkspace {
  const dropped: string[] = [];
  const droppedSearches: string[] = [];
  if (tabs === undefined || tabs === null) return { practices: [], activePracticeId: null, dropped, droppedSearches };
  if (!Array.isArray(tabs)) {
    return { practices: [], activePracticeId: null, dropped: [`workspaceTabs: not a list (${typeof tabs})`], droppedSearches };
  }

  // Ids are unique across the result: practices, acts and decisions are named by them.
  const used = new Set<string>();
  const claim = (wanted: unknown): string => {
    const id = typeof wanted === 'string' && wanted !== '' && !used.has(wanted) ? wanted : newId();
    used.add(id);
    return id;
  };

  const normTabs: { tab: LegacyTab; practice: Practice }[] = [];
  const decisionTabs: { tab: LegacyTab; reference: PracticeDecision['reference']; label: string }[] = [];
  const searchTabs: { tab: LegacyTab; query: DecisionSearchQuery; label: string }[] = [];

  tabs.forEach((raw: unknown, index: number) => {
    if (!isObject(raw) || typeof raw.id !== 'string' || raw.id === '') {
      dropped.push(`tab #${index}: no id (${raw === null ? 'null' : typeof raw})`);
      return;
    }
    const tab: LegacyTab & { id: string } = { ...raw, id: raw.id };
    const label = typeof tab.label === 'string' ? tab.label : '';
    const where = `tab "${label || tab.id}"`;

    if (tab.view !== undefined) {
      const view = (isObject(tab.view) ? tab.view : {}) as { kind?: unknown; reference?: unknown; query?: unknown };
      const reference = view.kind === 'decision' ? storedReference(view.reference) : null;
      if (reference) {
        decisionTabs.push({ tab, reference, label: labelOr(label, formatDecisionShort(reference)) });
        return;
      }
      if (view.kind === 'decision-search' && isStoredQuery(view.query)) {
        searchTabs.push({ tab, query: view.query, label: labelOr(label, DEFAULT_SEARCH_LABEL) });
        return;
      }
      // As the store did on rehydration: a malformed view goes; a tab left without content with it.
      // A decision of a court VisuaLex does not read goes too, never labelled as another court's.
      const court = view.kind === 'decision' && isValidView(view) ? `, the court ${String((view.reference as { corte?: unknown }).corte)}` : '';
      dropped.push(`${where}: a view that cannot be read (${String(view.kind)}${court})`);
      if (!Array.isArray(tab.content) || tab.content.length === 0) return;
    }

    const practice: Practice = {
      id: claim(tab.id), label: labelOr(label, DEFAULT_PRACTICE_LABEL), labelIsCustom: tab.labelIsCustom === true,
      acts: [], decisions: [], beside: [],
    };
    if (tab.content !== undefined && !Array.isArray(tab.content)) {
      dropped.push(`${where}: its content is not a list`);
    }
    const content: unknown[] = Array.isArray(tab.content) ? tab.content : [];
    content.forEach((rawItem, i) => {
      const item = rawItem as LegacyItem | null;
      try {
        practice.acts = addItem(practice.acts, item, `${where}, item #${i}`, claim, dropped);
      } catch (error) {
        // A shape no check foresaw: the item goes, the rest of the workspace stays (never thrown).
        dropped.push(`${where}, item #${i}: could not be read (${error instanceof Error ? error.message : String(error)})`);
      }
    });
    normTabs.push({ tab, practice });
  });

  const practices = normTabs.map((t) => t.practice);
  let host = front(normTabs)?.practice;
  if (!host && (decisionTabs.length > 0 || searchTabs.length > 0)) {
    host = { id: claim(undefined), label: DECISIONS_PRACTICE_LABEL, labelIsCustom: false, acts: [], decisions: [], beside: [] };
    practices.push(host);
  }

  for (const { tab, reference, label } of decisionTabs) {
    const target = host as Practice;
    const twin = target.decisions.find((d) => d.reference.corte === reference.corte && d.reference.numero === reference.numero &&
      d.reference.anno === reference.anno && d.reference.archivio === reference.archivio);
    if (twin) continue; // two tabs of one decision cannot exist; if they do, one entry
    const entry: PracticeDecision = { id: claim(tab.id), reference, label, identified: false };
    if (typeof tab.historyRecordedKey === 'string') entry.historyRecordedKey = tab.historyRecordedKey;
    target.decisions.push(entry);
  }

  // In front first; a stable sort keeps the dock's order among equals.
  const ordered = [...searchTabs].sort((a, b) => (before(a.tab, b.tab) ? -1 : before(b.tab, a.tab) ? 1 : 0));
  ordered.forEach((search, i) => {
    if (i > 0) {
      droppedSearches.push(search.label);
      return;
    }
    const ref: BesideRef = { id: claim(search.tab.id), kind: 'decision-search', query: search.query, label: search.label };
    (host as Practice).beside = [ref];
  });

  // The practice of the tab in front: a decision or a topic tab in front lives in `host` too.
  return { practices, activePracticeId: host?.id ?? null, dropped, droppedSearches };
}

// One saved item of a tab into the practice's acts.
function addItem(
  acts: PracticeAct[],
  item: LegacyItem | null,
  where: string,
  claim: (wanted: unknown) => string,
  dropped: string[],
): PracticeAct[] {
  const type = isObject(item) ? item.type : undefined;
  if (type === 'norma') {
    const block = item as LegacyNormaBlock;
    const norma = storedNorma(block.norma);
    if (!norma) {
      dropped.push(`${where}: a norm block without an act type`);
      return acts;
    }
    const articles = articlesOf(block.articles, where, dropped);
    const before = acts.length;
    const result = addArticles(acts, norma, articles, () => claim(block.id));
    if (result.acts.length > before && block.isCollapsed === true) {
      result.acts[result.acts.length - 1] = { ...result.acts[result.acts.length - 1], isCollapsed: true };
    }
    return result.acts;
  }
  if (type === 'loose-article') {
    const loose = item as LegacyLooseArticle;
    if (!isStoredArticle(loose.article)) {
      dropped.push(`${where}: an extracted article without norma_data`);
      return acts;
    }
    const act = actOfArticle(loose.article, loose.sourceNorma);
    if (!act) {
      dropped.push(`${where}: an extracted article whose act has no type`);
      return acts;
    }
    return addArticles(acts, act, [loose.article], () => claim(undefined)).acts;
  }
  if (type === 'collection') {
    const entries = (item as LegacyCollection).articles;
    if (!Array.isArray(entries)) {
      dropped.push(`${where}: a collection without a list of articles`);
      return acts;
    }
    let next = acts;
    entries.forEach((entry: unknown, i: number) => {
      const e = isObject(entry) ? entry : {};
      if (!isStoredArticle(e.article)) {
        dropped.push(`${where}: entry #${i} of a collection has no article`);
        return;
      }
      const act = actOfArticle(e.article, e.sourceNorma);
      if (!act) {
        dropped.push(`${where}: entry #${i} of a collection names an act without a type`);
        return;
      }
      next = addArticles(next, act, [e.article], () => claim(undefined)).acts;
    });
    return next;
  }
  dropped.push(`${where}: an item of unknown type (${String(type)})`);
  return acts;
}

function articlesOf(raw: unknown, where: string, dropped: string[]): ArticleData[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    dropped.push(`${where}: a block whose articles are not a list`);
    return [];
  }
  return raw.filter((article: unknown, i: number) => {
    if (isStoredArticle(article)) return true;
    dropped.push(`${where}: article #${i} has no norma_data`);
    return false;
  });
}

/** The notice of the topic searches not reopened (spec §9), or null when every one was. */
export function practiceNoticeText(droppedSearches: string[]): string | null {
  if (droppedSearches.length === 0) return null;
  const names = droppedSearches.map((label) => `«${label}»`).join(', ');
  return droppedSearches.length === 1
    ? `Una ricerca per tema non è stata riaperta: ${names}. Puoi rifarla dalla barra di ricerca.`
    : `${droppedSearches.length} ricerche per tema non sono state riaperte: ${names}. Puoi rifarle dalla barra di ricerca.`;
}
