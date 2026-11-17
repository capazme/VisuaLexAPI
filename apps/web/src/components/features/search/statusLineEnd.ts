import { createContext, type ReactNode } from 'react';

/**
 * Set by the reading of one article (LC70, Luca): the act's article selector, at the end of the status line. The line
 * then has the bar's one rule under it, and the tools go under the rule (`ReadingToolbar`).
 */
export const StatusLineEnd = createContext<ReactNode>(null);
