/**
 * The "go back" stack for reading navigation.
 *
 * It records ONLY jumps taken from a citation in the article text. Picking an
 * article from the structure window does not lose your place — the article
 * appears inside the block you are already reading — and a previous/next arrow
 * is already undone by the opposite arrow. Recording those would fill the
 * stack with stops nobody wants to walk back through, which is how a back
 * control becomes useless.
 *
 * Entries point at workspace tab and block ids, which are only meaningful
 * within a session: the stack is deliberately not persisted.
 */

/** Where the reader was standing before a citation jump. */
export interface ReadingBackEntry {
  tabId: string;
  blockId: string;
  /** `uniqueArticleId` encoding — see `utils/articleIds.ts`. */
  articleId: string;
  /** Human-readable destination, e.g. "Art. 2043 c.c.". Shown on the control. */
  label: string;
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
}

/**
 * Index of the newest entry that still points at a live tab and block, or -1.
 *
 * Tabs and blocks can be closed while their entries sit in the stack; walking
 * past the dead ones is what keeps "back" from landing nowhere.
 */
export function findLiveBackIndex(
  stack: ReadingBackEntry[],
  tabs: BackStackTab[],
): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];
    const tab = tabs.find(t => t.id === entry.tabId);
    if (tab?.content.some(c => c.type === 'norma' && c.id === entry.blockId)) {
      return i;
    }
  }
  return -1;
}

/** Newest entry that can still be returned to, or null. */
export function peekReadingBack(
  stack: ReadingBackEntry[],
  tabs: BackStackTab[],
): ReadingBackEntry | null {
  const index = findLiveBackIndex(stack, tabs);
  return index >= 0 ? stack[index] : null;
}

/** Append an entry, discarding the oldest once the cap is reached. */
export function appendBackEntry(
  stack: ReadingBackEntry[],
  entry: ReadingBackEntry,
): ReadingBackEntry[] {
  const next = [...stack, entry];
  return next.length > READING_BACK_STACK_CAP
    ? next.slice(next.length - READING_BACK_STACK_CAP)
    : next;
}
