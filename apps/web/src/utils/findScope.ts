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
import type { DecisionIdentity } from '../types/decisions';
import type { WorkspaceTab } from '../store/useAppStore';
import { buildItemKey, uniqueArticleIdFromNorma } from './normaKeys';
import { versionKey } from './versionDisplay';
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
}

function articleTargets(tabId: string, articles: ArticleData[]): FindTarget[] {
  return articles.map((article) => {
    const norma = article.norma_data;
    return {
      tabId,
      targetKey: `${buildItemKey(norma)}|${versionKey(norma)}`,
      label: shortNorm(norma),
      storedText: plainText(article.article_text || ''),
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
    storedText: cached?.esito === 'trovata' ? decisionProjection(cached.testo) : undefined,
  };
}

function targetsOfTab(tab: WorkspaceTab): FindTarget[] {
  if (tab.view?.kind === 'decision') {
    const target = decisionTarget(tab);
    return target ? [target] : [];
  }
  // A decision-search tab draws a list of decisions, not a text of its own.
  if (tab.view) return [];
  const targets: FindTarget[] = [];
  for (const item of tab.content) {
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
 * decision tab one text.
 */
export function findTargetsInScope(
  state: FindScopeState,
  scope: FindScope,
  frontTabId: string | null,
): FindTarget[] {
  const tabs = scope === 'tab' ? state.workspaceTabs.filter((t) => t.id === frontTabId) : state.workspaceTabs;
  const targets: FindTarget[] = [];
  for (const tab of tabs) targets.push(...targetsOfTab(tab));
  return targets;
}

/**
 * The tab «Questa scheda» means: on a desktop, the visible tab (not hidden, not minimised)
 * `bringTabToFront` last raised — the highest `zIndex` among them. A phone has no such flag to
 * filter by (the carousel can swipe to a tab that stayed minimised from a wider session, gotcha:
 * `SearchPanel`'s own mobile index never touches `zIndex` on an ordinary swipe either), so the same
 * highest-`zIndex` reading is taken over every tab — the best a store-only read can do; `null` with
 * no open tab.
 */
export function frontTabId(state: FindScopeState, isDesktop: boolean): string | null {
  const candidates = isDesktop ? state.workspaceTabs.filter((t) => !t.isHidden && !t.isMinimized) : state.workspaceTabs;
  let front: WorkspaceTab | undefined;
  for (const tab of candidates) {
    if (!front || tab.zIndex > front.zIndex) front = tab;
  }
  return front ? front.id : null;
}
