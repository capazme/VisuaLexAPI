import { FOCUS_RING } from '../studia/progress/tokens';

/**
 * A dossier's page in the planner's shape (S7c): the planner's targets and measures — every control 44 px at every
 * width — and its rows of two levels (the task's title, a grey line, the signs at the right), in the «Inchiostro»
 * tokens, light and dark. The page, its act blocks, its notes and its decisions draw from here.
 */

/** The header's main action: «Apri tutto». */
export const HEADER_PRIMARY = `inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-40 ${FOCUS_RING}`;

/** A header's other action with words: «Aggiungi», «Esporta», the Forum's (only their icons on a phone: 44 px square). */
export const HEADER_BUTTON = `inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 ${FOCUS_RING}`;

/** A header's icon-only action: «⋯». */
export const HEADER_ICON_BUTTON = `inline-grid h-11 w-11 place-items-center rounded-lg border border-slate-300 bg-white text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 ${FOCUS_RING}`;

/** A block of the page (an act, the notes, the decisions): a tile on the paper, no shadow. */
export const SECTION_TILE = 'rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900';

/** A block's heading: the reader's serif, sentence case, no small capitals. */
export const SECTION_HEADING = 'font-serif text-lg font-medium tracking-tight text-slate-900 dark:text-slate-50';

/**
 * A column's title when the dossier holds decisions (D7a): «Norme» on the left, «Giurisprudenza» on the right, a step
 * over the acts' own headings.
 */
export const COLUMN_HEADING = 'mb-2 font-serif text-xl font-medium tracking-tight text-slate-900 dark:text-slate-50';

/**
 * A column of two from `lg` (D7d): as tall as the window less the page's padding and foot (`max-h-app-column`), scrolling
 * on its own, so a decision read on the right stays put while a norm opens on the left, and the other way. The column
 * is a named region and a tab stop (`tabIndex={0}`, the focus ring), so the keyboard's arrows scroll it.
 */
export const COLUMN_SCROLLS = `lg:max-h-app-column lg:overflow-y-auto ${FOCUS_RING}`;

/** The count beside a block's heading. */
export const SECTION_COUNT = 'font-sans text-sm font-normal text-slate-600 dark:text-slate-400';

/** A row of a block: a thin rule under it, as the planner's tasks; the last one has none. */
export const ROW = 'group relative border-b border-slate-200 last:border-b-0 dark:border-slate-800';

/** A row's title, the first level: 15 px, as a task's. */
export const ROW_TITLE = 'text-[15px] leading-snug text-slate-900 dark:text-slate-50';

/** A row's grey line, the second level: 13 px, as a task's description. */
export const ROW_LINE = 'text-[13px] leading-snug text-slate-600 dark:text-slate-400';

/** An icon at a row's right end (the star, the removal): 44 px square at every width. */
export const ROW_ICON = `inline-grid h-11 w-11 shrink-0 place-items-center rounded-md transition-colors ${FOCUS_RING}`;

/**
 * The box of a row's traffic light (D7b, `AiReviewSignal`), last in the row's toggle: as tall as the buttons beside it
 * (`ROW_ICON`) and across the toggle's own padding (`py-2.5`), its sign centred in it, so it sits on the star's and the
 * bin's line. Inline after the title's signs it sat about 4 px higher.
 */
export const ROW_SIGN = '-my-2.5 flex h-11 shrink-0 items-center';

/** The removal at a row's right end: always there, as the planner's «⋯», in grey until the pointer is on it. */
export const ROW_REMOVE = `${ROW_ICON} text-slate-500 hover:bg-red-50 hover:text-red-700 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-300`;
