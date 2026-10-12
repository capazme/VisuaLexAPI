/**
 * The "go back" stack for reading navigation.
 *
 * It records jumps taken from a citation in the article text, the jump from an article to a
 * decision opened beside it, and the jump from a decision to a norm it cites (the entry names the
 * decision's tab as its own block). Picking an
 * article from the structure window does not lose your place — the article
 * appears inside the block you are already reading — and a previous/next arrow
 * is already undone by the opposite arrow. Recording those would fill the
 * stack with stops nobody wants to walk back through, which is how a back
 * control becomes useless.
 *
 * Entries point at workspace tab and block ids, or at a practice and what it holds, which are only
 * meaningful within a session: the stack is deliberately not persisted.
 *
 * Two shapes while `VITE_FEATURE_PRACTICE_TABLE` exists (spec `2026-10-08-norm-tab-container-design.md`
 * §6.3): the reading surfaces keep pushing a `ReadingBackEntry`; the store keeps it as given, or
 * turns one whose `tabId` names a practice or a window into a `PracticeBackEntry`. P6 drops the tab
 * shape.
 */
import { holdsSubject, type Practice, type PracticeSubject } from './practice';

/** Where the reader was standing before a citation jump, as a reading surface names it: `tabId` is
 *  a tab, a practice (a row of its table) or a window beside it; `blockId` a block, an act or a
 *  decision. */
export interface ReadingBackEntry {
  tabId: string;
  blockId: string;
  /** `uniqueArticleId` encoding — see `utils/articleIds.ts`. */
  articleId: string;
  /** A practice's row: its `practiceArticleKey`, version included, so the way back to a past text
   *  reveals that row, never the text in force (carry-over ruling 12). Read only for an entry kept as
   *  a practice's; `articleId` names the row when no row holds this key. */
  articleKey?: string;
  /** Human-readable destination, e.g. "Art. 2043 c.c.". Shown on the control. */
  label: string;
}

/** Where the reader was standing in a practice: the subject, and whether it was read in its row of
 *  the table or in a window beside it. */
export interface PracticeBackEntry {
  practiceId: string;
  subject: PracticeSubject;
  place: 'table' | 'beside';
  /** Human-readable destination, shown on the control. */
  label: string;
}

/** An entry of the stack: either shape. */
export type BackStackEntry = ReadingBackEntry | PracticeBackEntry;

export function isPracticeBackEntry(entry: BackStackEntry): entry is PracticeBackEntry {
  return 'practiceId' in entry;
}

/** How many jumps we remember before discarding the oldest. */
export const READING_BACK_STACK_CAP = 50;

/**
 * Structural shape of a workspace tab, kept local so this module does not
 * import from the store (which imports from here).
 */
interface BackStackTab {
  id: string;
  content: Array<{ type: string; id: string }>;
  /** A decision (or a search) tab holds no blocks: it is its own place to come back to. */
  view?: { kind: string };
}

/**
 * Index of the newest entry that still points at a live tab and block, or at a practice that still
 * holds its subject, or -1.
 *
 * Tabs and blocks, practices and what they hold can be closed while their entries sit in the stack;
 * walking past the dead ones is what keeps "back" from landing nowhere.
 */
export function findLiveBackIndex(
  stack: BackStackEntry[],
  tabs: BackStackTab[],
  practices: Practice[] = [],
): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];
    if (isPracticeBackEntry(entry)) {
      const practice = practices.find(p => p.id === entry.practiceId);
      if (practice && holdsSubject(practice, entry.subject)) return i;
      continue;
    }
    const tab = tabs.find(t => t.id === entry.tabId);
    // A decision tab has no norma block: its entry names the tab itself as the block.
    const isDecision = tab?.view?.kind === 'decision' && entry.blockId === tab.id;
    if (isDecision || tab?.content.some(c => c.type === 'norma' && c.id === entry.blockId)) {
      return i;
    }
  }
  return -1;
}

/** Newest entry that can still be returned to, or null. */
export function peekReadingBack(
  stack: BackStackEntry[],
  tabs: BackStackTab[],
  practices: Practice[] = [],
): BackStackEntry | null {
  const index = findLiveBackIndex(stack, tabs, practices);
  return index >= 0 ? stack[index] : null;
}

/** Append an entry, discarding the oldest once the cap is reached. */
export function appendBackEntry<T extends BackStackEntry>(
  stack: T[],
  entry: T,
): T[] {
  const next = [...stack, entry];
  return next.length > READING_BACK_STACK_CAP
    ? next.slice(next.length - READING_BACK_STACK_CAP)
    : next;
}
