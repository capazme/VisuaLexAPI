/**
 * The texts a search over the workspace can reach (spec §13.1, Task 33): the ordered list of
 * targets in «Questa scheda» or «Tutte le schede», built from the store's workspace tabs alone —
 * no DOM, so it is tested without one, like `utils/versionDisplay.ts`.
 *
 * A target is an article (one per article actually loaded in a block, a loose article or a
 * collection — not only the one a block currently shows: an article open but not drawn still
 * counts, searched in its stored text) or a decision tab (one text). `storedText` is always the
 * projection — `article_text` with every `\n` dropped, or a decision's `decisionProjection` — so a
 * caller can `findMatches` it directly; the DOM, when a root is registered and displayed for the
 * same target, takes precedence (`findRootsFor`, never both — Task 33 ruling 2).
 */
import type { ArticleData } from '../types';
import type { DecisionIdentity, DecisionText } from '../types/decisions';
import type { WorkspaceTab } from '../store/useAppStore';
import { buildItemKey, uniqueArticleIdFromNorma } from './normaKeys';
import { describeVersion, versionKey } from './versionDisplay';
import { shortNorm } from './sources';
import { plainText } from './threadPassages';
import { decisionKey, formatDecisionShort } from './decisionLinks';
import { decisionProjection } from './decisionRender';
import { peekDecision } from './decisionFetchCache';

export type FindScope = 'tab' | 'all';

export interface FindTarget {
  tabId: string;
  /** The target's own key, within its tab: `${itemKey}|${versionKey}` for an article, the
   *  decision's key for a decision tab. `${tabId}|${targetKey}` is the target's full identity. */
  targetKey: string;
  label: string;
  /** The projection, when there is text to fall back on; absent while it is still loading. */
  storedText?: string;
  /** Set for an article alone: `focusArticleInTab`'s second argument, to show it once its tab is
   *  raised. A decision needs no such step — bringing its tab to front shows its one text. */
  articleId?: string;
}

/** The store slice both functions here read — narrow, so each is tested without the whole store. */
export interface FindScopeState {
  workspaceTabs: WorkspaceTab[];
  /** The phone's tab on screen (`SearchPanel`'s carousel); absent or not open reads as the first. */
  mobileActiveTabId?: string | null;
}

/** A decision's projection, once per text: the find window recomputes on every workspace change,
 *  and a cached `DecisionText` object is the same object until the decision is fetched again. */
const projections = new WeakMap<DecisionText, string>();

function projectionOf(testo: DecisionText): string {
  let projection = projections.get(testo);
  if (projection === undefined) {
    projection = decisionProjection(testo);
    projections.set(testo, projection);
  }
  return projection;
}

function articleTargets(tabId: string, articles: ArticleData[]): FindTarget[] {
  return articles.map((article) => {
    const norma = article.norma_data;
    // A text not shown (a version not yet in force, gotcha 32) is not searched either: the reader
    // could never see what a match pointed at.
    const textVisible = describeVersion(article.validity, norma).textVisible;
    return {
      tabId,
      targetKey: `${buildItemKey(norma)}|${versionKey(norma)}`,
      label: shortNorm(norma),
      storedText: textVisible ? plainText(article.article_text || '') : undefined,
      articleId: uniqueArticleIdFromNorma(norma),
    };
  });
}

/** A decision tab's target, or null when the reference has no archive yet (a bare Cassazione
 *  citation still resolving): there is no stable key and no text to search until then. */
function decisionTarget(tab: WorkspaceTab): FindTarget | null {
  if (tab.view?.kind !== 'decision') return null;
  const ref = tab.view.reference;
  if (ref.corte === 'cassazione' && !ref.archivio) return null;
  const identity: DecisionIdentity = {
    corte: ref.corte,
    numero: ref.numero,
    anno: ref.anno,
    ...(ref.archivio ? { archivio: ref.archivio } : {}),
  };
  const cached = peekDecision(identity);
  return {
    tabId: tab.id,
    targetKey: decisionKey(identity),
    label: formatDecisionShort({ ...identity, sezione: ref.sezione }),
    storedText: cached?.esito === 'trovata' ? projectionOf(cached.testo) : undefined,
  };
}

function targetsOfTab(tab: WorkspaceTab, phone: boolean): FindTarget[] {
  if (tab.view?.kind === 'decision') {
    const target = decisionTarget(tab);
    return target ? [target] : [];
  }
  // A decision-search tab draws a list of decisions, not a text of its own.
  if (tab.view) return [];
  const targets: FindTarget[] = [];
  for (const item of tab.content) {
    // The phone column draws norm blocks alone (`SearchPanel` filters on `type === 'norma'`).
    if (phone && item.type !== 'norma') continue;
    if (item.type === 'norma') targets.push(...articleTargets(tab.id, item.articles));
    else if (item.type === 'loose-article') targets.push(...articleTargets(tab.id, [item.article]));
    else targets.push(...articleTargets(tab.id, item.articles.map((a) => a.article)));
  }
  return targets;
}

/**
 * The ordered targets of the scope: «Questa scheda» is `frontTabId` alone, «Tutte le schede» is
 * every open tab in dock order (`workspaceTabs`'s own order — `WorkspaceNavigator` renders it
 * unsorted, minimised tabs included); inside a tab, block and article as the tab shows them, a
 * decision tab one text. The same article twice in one tab (in a block and in a collection) is one
 * target, where it first appears: its key names one root, so it is searched and counted once.
 * On a phone (`options.phone`) the loose articles and collections are left out: its column never
 * draws them, so counting them would only promise matches that cannot be shown.
 */
export function findTargetsInScope(
  state: FindScopeState,
  scope: FindScope,
  frontTabId: string | null,
  options: { phone?: boolean } = {},
): FindTarget[] {
  const tabs = scope === 'tab' ? state.workspaceTabs.filter((t) => t.id === frontTabId) : state.workspaceTabs;
  const targets: FindTarget[] = [];
  const seen = new Set<string>();
  for (const tab of tabs) {
    for (const target of targetsOfTab(tab, options.phone === true)) {
      const id = `${target.tabId}|${target.targetKey}`;
      if (seen.has(id)) continue;
      seen.add(id);
      targets.push(target);
    }
  }
  return targets;
}

/**
 * The tab «Questa scheda» means: on a desktop, the visible tab (not hidden, not minimised)
 * `bringTabToFront` last raised — the highest `zIndex` among them; on a phone, the tab the carousel
 * shows (`mobileActiveTabId`, the first tab when it names none that is open — as the carousel reads
 * it), whatever its `zIndex`: a swipe never raises a tab. `null` with no open tab.
 */
export function frontTabId(state: FindScopeState, isDesktop: boolean): string | null {
  if (!isDesktop) {
    const onScreen = state.workspaceTabs.find((t) => t.id === state.mobileActiveTabId) ?? state.workspaceTabs[0];
    return onScreen ? onScreen.id : null;
  }
  let front: WorkspaceTab | undefined;
  for (const tab of state.workspaceTabs) {
    if (tab.isHidden || tab.isMinimized) continue;
    if (!front || tab.zIndex > front.zIndex) front = tab;
  }
  return front ? front.id : null;
}
