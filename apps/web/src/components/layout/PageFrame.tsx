import { useId, type ReactNode } from 'react';
import { FOCUS_RING } from '../../constants/interactions';
import { kickerOf, type SectionId } from '../../features/sections/sections';
import { cn } from '../../lib/utils';
import type { PageWidth } from './frame';

/** A page's title: Newsreader, 28 px on a phone and 30 px from `md`, the same on every section page. */
export const PAGE_TITLE = 'font-serif text-[28px] font-medium leading-tight tracking-tight text-slate-900 md:text-3xl dark:text-slate-50';

/**
 * Room on the right of a top row with controls (a header's action, the practice's table), for `Layout`'s full-screen
 * button (`fixed top-4 right-4`, 44 px). `Layout` says where the button floats over the page's top right with
 * `--focus-button-room`, 4.25 rem: from `lg`, and from `md` in full screen, which draws no bar for it to sit in; never on
 * the search page's field. There a control must end 68 px from the window's right edge (the button's 60 and 8 of air).
 * The frame's right edge is `(100vw − --sidebar-width − F) / 2` from it, F the frame's own width — `100%` of the row's
 * containing block, whatever the window, the full screen or the page's width (U1) —; a scrollbar only moves it further.
 * So the row pads 68 px less that, and nothing once it is past 68: 36 px at 1280 px with the wide sidebar (the 32 px
 * margin), 20 px from 1536 px while the frame fills the window (the 48 px margin), nothing once the window less the
 * sidebar is 136 px wider than the frame, or where the button does not float.
 */
export const FOCUS_BUTTON_CLEARANCE = 'pr-[max(0px,calc(var(--focus-button-room,0px)_-_(100vw_-_var(--sidebar-width,0px)_-_100%)_/_2))]';

/** The section's line over a title (L-37): Geist, small, quiet. */
export const PAGE_KICKER = 'text-sm text-slate-600 dark:text-slate-400';

export interface PageFrameProps {
  /** The page's name («Oggi», «Le mie schede»): since L-37 the section's phrase is the `kicker` over it, not the title. */
  title: ReactNode;
  /** The section the page belongs to: its name and phrase over the title, small («Gymnasium · la tua palestra giuridica»). */
  kicker?: SectionId;
  /** The sentence under the title. */
  line?: ReactNode;
  /** The page's main action, beside the title from `md`, under it on a phone. */
  action?: ReactNode;
  /** The action stays beside the title on a phone too, at its first line: icon buttons only (the dossier list's «⋯»
   *  and «+», M1). */
  actionBeside?: boolean;
  /** A section's home: the title is where the section switcher puts the focus (`sectionTransition.ts`). */
  section?: SectionId;
  /** The title's id, for a landmark it names. */
  titleId?: string;
  /** The page's width, declared once (U1, `frame.ts`): `reading` keeps the body at the reading measure, `full` widens
   *  `Layout`'s frame to the full screen's; `work`, the frame, by default. */
  width?: PageWidth;
  className?: string;
  children: ReactNode;
}

/**
 * The frame of a section page (W2, U1): the layout's own frame (`frame.ts`: the window less its margins, at most 1600
 * px, 2400 in full screen) with nothing narrower inside, the title at the column's left edge in one size, the sentence
 * under it, the action on its right, and no icon beside it. A page whose body reads as long text says `reading`: the
 * body narrows to the reading measure, never the title. A section's page names itself in the title and its section
 * over it (`kicker`, L-37). Outside it: the Scrivania, the lesson, the reader and the practice, the login.
 */
export function PageFrame({ title, kicker, line, action, actionBeside = false, section, titleId, width = 'work', className, children }: PageFrameProps) {
  // The title says only the page's name («Oggi» in Opus and in Gymnasium): the line over it describes it, so the focus
  // the section switcher puts on the title also says which section it is in.
  const kickerId = useId();
  // A section with no phrase yet draws no line, and the title describes nothing.
  const kickerText = kicker ? kickerOf(kicker) : null;
  return (
    <div data-page-width={width} className={cn('flex w-full min-w-0 flex-col gap-6', className)}>
      <header className={cn(
        'flex gap-4 md:flex-row md:items-center md:justify-between',
        actionBeside ? 'flex-row items-start justify-between' : 'flex-col',
        action && FOCUS_BUTTON_CLEARANCE,
      )}>
        <div className="min-w-0">
          {kickerText && (
            <p id={kickerId} className={cn(PAGE_KICKER, 'mb-1')}>
              {kickerText}
            </p>
          )}
          <h1 id={titleId} aria-describedby={kickerText ? kickerId : undefined} data-section-title={section} tabIndex={section ? -1 : undefined} className={cn(PAGE_TITLE, section && cn(FOCUS_RING, 'rounded-sm'))}>
            {title}
          </h1>
          {line && <p className="mt-1 max-w-prose text-slate-600 dark:text-slate-400">{line}</p>}
        </div>
        {action && <div className="flex shrink-0 gap-2">{action}</div>}
      </header>
      {width === 'reading' ? <div className="flex min-w-0 max-w-measure flex-col gap-6">{children}</div> : children}
    </div>
  );
}
