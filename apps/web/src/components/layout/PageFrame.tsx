import { useId, type ReactNode } from 'react';
import { FOCUS_RING } from '../../constants/interactions';
import { kickerOf, type SectionId } from '../../features/sections/sections';
import { cn } from '../../lib/utils';

/** A page's title: Newsreader, 28 px on a phone and 30 px from `md`, the same on every section page. */
export const PAGE_TITLE = 'font-serif text-[28px] font-medium leading-tight tracking-tight text-slate-900 md:text-3xl dark:text-slate-50';

/**
 * Room on the right of a header with an action, for `Layout`'s Focus button (`fixed top-4 right-4`, 44 px, from
 * `md`; below `lg` the page starts under it). The action must end 68 px from the window's right edge (the button's 60
 * and 8 of air); the frame leaves it `(C − 1280) / 2 + 32`, where C is the content column (`100vw` less
 * `--sidebar-width`, less a scrollbar of up to 15 px): so the header pads `44 − (C − 1280) / 2` px, between 0 and 44 —
 * nothing from a window of about 1590 px with the wide sidebar, 44 px up to a 1280 px column.
 */
export const FOCUS_BUTTON_CLEARANCE = 'lg:pr-[clamp(0px,calc(2.75rem_-_(100vw_-_var(--sidebar-width,0px)_-_80rem)_/_2),2.75rem)]';

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
  className?: string;
  children: ReactNode;
}

/**
 * The frame of a section page (W2): the layout's own width (`Layout`'s `max-w-7xl` and its padding, the 1216 px
 * column of Dossier and Forum) with nothing narrower inside, the title at the column's left edge in one size, the
 * sentence under it, the action on its right, and no icon beside it. A page whose body reads as long text narrows
 * the body, never the title. A section's page names itself in the title and its section over it (`kicker`, L-37).
 * Outside it: the Scrivania, the lesson, the reader and the practice, the login.
 */
export function PageFrame({ title, kicker, line, action, actionBeside = false, section, titleId, className, children }: PageFrameProps) {
  // The title says only the page's name («Oggi» in Opus and in Gymnasium): the line over it describes it, so the focus
  // the section switcher puts on the title also says which section it is in.
  const kickerId = useId();
  // A section with no phrase yet (Academia) draws no line, and the title describes nothing.
  const kickerText = kicker ? kickerOf(kicker) : null;
  return (
    <div className={cn('flex w-full min-w-0 flex-col gap-6', className)}>
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
      {children}
    </div>
  );
}
