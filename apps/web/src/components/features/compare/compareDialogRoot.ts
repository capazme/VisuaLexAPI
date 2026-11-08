import { createContext, type RefObject } from 'react';

/**
 * The comparison's dialog, where what it opens is portalled (the update notes): a modal dialog hides from a screen
 * reader what lies outside it, and its Tab trap would pull the focus out of a popover drawn in the body.
 */
export const CompareDialogRoot = createContext<RefObject<HTMLElement | null> | null>(null);
