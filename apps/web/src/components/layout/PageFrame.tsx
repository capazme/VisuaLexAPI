import type { ReactNode } from 'react';
import { FOCUS_RING } from '../../constants/interactions';
import type { SectionId } from '../../features/sections/sections';
import { cn } from '../../lib/utils';

/** A page's title: Newsreader, 28 px on a phone and 30 px from `md`, the same on every section page. */
export const PAGE_TITLE = 'font-serif text-[28px] font-medium leading-tight tracking-tight text-slate-900 md:text-3xl dark:text-slate-50';

export interface PageFrameProps {
  title: ReactNode;
  /** The sentence under the title. */
  line?: ReactNode;
  /** The page's main action, beside the title from `md`, under it on a phone. */
  action?: ReactNode;
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
 * the body, never the title. Outside it: the Scrivania, the lesson, the reader and the practice, the login.
 */
export function PageFrame({ title, line, action, section, titleId, className, children }: PageFrameProps) {
  return (
    <div className={cn('flex w-full min-w-0 flex-col gap-6', className)}>
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 id={titleId} data-section-title={section} tabIndex={section ? -1 : undefined} className={cn(PAGE_TITLE, section && cn(FOCUS_RING, 'rounded-sm'))}>
            {title}
          </h1>
          {line && <p className="mt-1 max-w-prose text-slate-600 dark:text-slate-400">{line}</p>}
        </div>
        {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
      </header>
      {children}
    </div>
  );
}
