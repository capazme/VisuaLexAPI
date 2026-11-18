import { FOCUS_RING } from '../studia/progress/tokens';
import { cn } from '../../../lib/utils';
import { buttonClassName } from '../../ui/buttonStyles';

/**
 * A dossier's page in the planner's shape (S7c): its rows of two levels (the task's title, a grey line, the signs at
 * the right), in the «Inchiostro» tokens, light and dark. The header's buttons have `Button`'s heights (LC106: 44 px on
 * a phone, 36 from md); a row's icons stay 44 px at every width. The page, its act blocks, its notes and its decisions
 * draw from here.
 */

/**
 * A header's trigger with words, for `MenuButton` and the Forum's action, which draw their own `<button>`: «Aggiungi»,
 * «Esporta» (only their icons on a phone: 44 px square). `Button variant="secondary"`'s look (LC106).
 */
export const HEADER_BUTTON = cn(buttonClassName('secondary'), 'min-w-11 px-3 whitespace-nowrap');

/** A header's icon-only trigger, «⋯»: `IconButton`'s square on the secondary look (LC106). */
export const HEADER_ICON_BUTTON = cn(buttonClassName('secondary'), 'min-w-11 px-0 md:min-w-9');

/** A block's heading: the reader's serif, sentence case, no small capitals. */
export const SECTION_HEADING = 'font-serif text-lg font-medium tracking-tight text-slate-900 dark:text-slate-50';

/** The count beside a block's heading. */
export const SECTION_COUNT = 'font-sans text-sm font-normal text-slate-600 dark:text-slate-400';

/** A row of a block: a thin rule under it, as the planner's tasks; the last one has none. */
export const ROW = 'group relative border-b border-slate-200 last:border-b-0 dark:border-slate-800';

/** A row's title, the first level: 15 px, as a task's. */
export const ROW_TITLE = 'text-[15px] leading-snug text-slate-900 dark:text-slate-50';

/** A row's grey line, the second level: 13 px, as a task's description. */
export const ROW_LINE = 'text-[13px] leading-snug text-slate-600 dark:text-slate-400';

/** A row's toggle (`role="button"`), the article's or the decision's: its title, grey line and signs. */
export const ROW_TOGGLE = `flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-md py-2.5 ${FOCUS_RING}`;

/**
 * The box of a row's sign on the star's line: the application's traffic light (D7b, `AiReviewSignal`) and, on an
 * article's closed row, the notes' count. In the row's toggle, as tall as the buttons beside it (`ROW_REMOVE`, 44 px) and across
 * the toggle's own padding (its `py-2.5`, `ROW_TOGGLE`: the two change together), its sign centred in it. Inline after
 * the title the light sat 1 to 3 px higher, the count 2.
 */
export const ROW_SIGN = '-my-2.5 flex h-11 shrink-0 items-center';

/**
 * The removal at a row's right end, on an `IconButton size="lg"` (44 px square at every width): always there, as the
 * planner's «⋯», in grey until the pointer is on it.
 */
export const ROW_REMOVE = 'shrink-0 [&>svg]:h-4 [&>svg]:w-4 text-slate-500 hover:bg-red-50 hover:text-red-700 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-300';
