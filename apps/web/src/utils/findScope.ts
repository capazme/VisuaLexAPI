/**
 * The texts a search over the workspace can reach (spec §13.1, §6.6): the ordered list of targets in
 * «Questa pratica» or «Tutte le pratiche», built from the store's practices alone — no DOM, so it is
 * tested without one, like `utils/versionDisplay.ts`.
 *
 * A target is an article (one per article of an act, its row open or closed) or a decision entry
 * (one text). `storedText` is always the projection — `article_text` with every `\n` dropped, or a
 * decision's `decisionProjection` — so a caller can `findMatches` it directly; the DOM, when a root is
 * registered and displayed for the same target, takes precedence (`findRootsFor`; never both, or a
 * text would count twice).
 */
import type { DecisionIdentity, DecisionReference, DecisionText } from '../types/decisions';
import { describeVersion } from './versionDisplay';
import { shortNorm } from './sources';
import { plainText } from './threadPassages';
import { decisionKey, identityOf } from './decisionLinks';
import { isAdminCourt } from './adminCourts';
import { decisionProjection } from './decisionRender';
import { peekDecision } from './decisionFetchCache';
import { decisionOrder, practiceArticleKey, type Practice, type PracticeDecision } from './practice';

export type FindScope = 'tab' | 'all';

export interface FindTarget {
  tabId: string;
  /** The target's own key, within its practice: `practiceArticleKey` for an article, the decision's
   *  key for a decision. `${tabId}|${targetKey}` is the target's full identity. */
  targetKey: string;
  label: string;
  /** The projection, when there is text to fall back on; absent while it is still loading. */
  storedText?: string;
  /** The row to open to draw the subject (spec §6.7); `tabId` is its practice's id. */
  reveal: { kind: 'article'; actId: string; articleKey: string } | { kind: 'decision'; decisionId: string };
}

/** The store slice both functions here read — narrow, so each is tested without the whole store. */
export interface FindScopeState {
  /** The practices, in the bar's order, and the one on screen (spec §6.6). */
  practices?: Practice[];
  activePracticeId?: string | null;
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

/** The identity a reference already names, or null while it names none: a bare Cassazione citation
 *  with no archive, an administrative one with no kind, a TAR with no seat (design
 *  2026-10-12-administrative-courts §2). There is no stable key and no text to search until then. */
function stableIdentity(ref: DecisionReference): DecisionIdentity | null {
  if (ref.corte === 'cassazione' && !ref.archivio) return null;
  if (isAdminCourt(ref.corte) && (!ref.provvedimento || (ref.corte === 'tar' && !ref.sede))) return null;
  return identityOf(ref);
}

/** A practice's decision entry as a target, or null while it has no archive (no stable key, no text). */
function entryTarget(practice: Practice, entry: PracticeDecision, label: string): FindTarget | null {
  const ref = entry.reference;
  const identity = stableIdentity(ref);
  if (!identity) return null;
  const cached = peekDecision(identity);
  return {
    tabId: practice.id,
    targetKey: decisionKey(identity),
    label,
    // A decision never read (the dossier's «Apri tutto», T17) is not in the session's cache: it counts nothing.
    storedText: cached?.esito === 'trovata' ? projectionOf(cached.testo) : undefined,
    reveal: { kind: 'decision', decisionId: entry.id },
  };
}

/**
 * A practice's targets (spec §6.6): its acts in table order, an act's articles in column order (rows
 * open or closed, past texts included: each is its own text under its own key, which is its
 * `practiceArticleKey`), then its decisions newest first (`decisionOrder`). A topic search holds no
 * text. `withPractice` names the practice in each label, for «Tutte le pratiche»'s location line.
 */
function targetsOfPractice(practice: Practice, withPractice: boolean): FindTarget[] {
  const named = (label: string) => (withPractice ? `${label} · ${practice.label}` : label);
  const targets: FindTarget[] = [];
  for (const act of practice.acts) {
    for (const article of act.articles) {
      const norma = article.norma_data;
      const textVisible = describeVersion(article.validity, norma).textVisible;
      const articleKey = practiceArticleKey(article);
      targets.push({
        tabId: practice.id,
        targetKey: articleKey,
        label: named(shortNorm(norma)),
        storedText: textVisible ? plainText(article.article_text || '') : undefined,
        reveal: { kind: 'article', actId: act.id, articleKey },
      });
    }
  }
  for (const entry of decisionOrder(practice.decisions)) {
    const target = entryTarget(practice, entry, named(entry.label));
    if (target) targets.push(target);
  }
  return targets;
}

/**
 * The ordered targets of the scope: «Questa pratica» is the practice `frontTabId` names (the active
 * one), «Tutte le pratiche» is every practice in the bar's order; inside a practice, its acts and
 * their articles as the table shows them, then the decisions.
 */
export function findTargetsInScope(
  state: FindScopeState,
  scope: FindScope,
  frontTabId: string | null,
): FindTarget[] {
  // «Questa pratica» is the active one, «Tutte le pratiche» every practice in the bar's order. The
  // phone draws the same column, so it leaves nothing out.
  const practices = state.practices ?? [];
  const inScope = scope === 'tab' ? practices.filter((p) => p.id === frontTabId) : practices;
  return inScope.flatMap((p) => targetsOfPractice(p, scope === 'all'));
}

/** The practice «Questa pratica» means: the active one, on a desktop and a phone alike; `null` with none. */
export function frontTabId(state: FindScopeState): string | null {
  // The active practice on both breakpoints (the phone shows the active practice too).
  const id = state.activePracticeId ?? null;
  return id !== null && (state.practices ?? []).some((p) => p.id === id) ? id : null;
}
