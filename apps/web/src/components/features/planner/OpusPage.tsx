import { useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { scrollParentOf } from '../practice/practiceView';
import { CalendarDays, CalendarCheck, Inbox, Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { pageName } from '../../../features/sections/pageNames';
import { PageFrame } from '../../layout/PageFrame';
import { QUIET_BUTTON } from '../studia/progress/tokens';
import { FOCUS_RING } from '../../../constants/interactions';

/** The planner's three views, tabs of the page since Work's bar lists only its five entries (D-315, LC8): the short
 *  word on a phone, as the Forum's tabs, so the three share a 320 px row. */
const VIEWS = [
  { to: '/work/oggi', label: 'Oggi', short: 'Oggi', icon: CalendarCheck },
  { to: '/work/prossimi', label: 'Prossimi giorni', short: 'Prossimi', icon: CalendarDays },
  { to: '/work/ingresso', label: "Lista d'ingresso", short: 'Ingresso', icon: Inbox },
];

/**
 * Opus's page (the planner, wave 1): the view's name as the title, the section's phrase over it (L-37), over its views —
 * «Oggi» (Opus's home), «Prossimi giorni», «Lista d'ingresso» — which are the page's tabs (LC8; the sidebar has «Oggi»
 * among Work's five entries); «Dossier» stays an entry of Work. In the sections' frame (`PageFrame`, W2), its title the one the
 * section switcher focuses (T1); the views take the frame's width, the lists' rows with room for the dossier at their
 * right end (P2b). The tasks' trash is a view of its
 * own: a task's trash is on the task, not among the dossiers' (`/api/trash`).
 */
export function OpusPage() {
  const { pathname } = useLocation();
  // The trash's link belongs to the three views; the tabs to them and to the trash, as its way back (#448). Neither on
  // Atti and Anonimizzatore.
  const inView = VIEWS.some((view) => pathname.startsWith(view.to));
  const inTrash = pathname.startsWith('/work/cestino');
  const viewTop = useRef<HTMLDivElement>(null);
  /** Scrolled past the tabs, a change of view puts the scroller back where they stick; above them, nothing moves. */
  const keepPlace = () => {
    const mark = viewTop.current;
    const scroller = mark ? scrollParentOf(mark) : null;
    if (!mark || !scroller) return;
    const stuckAt = mark.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    if (scroller.scrollTop > stuckAt) scroller.scrollTop = stuckAt;
  };
  return (
    <PageFrame
      // The view's name, from the one list of the pages' names (L-37).
      title={pageName(pathname) ?? 'Oggi'}
      kicker="opus"
      section="opus"
      className="h-full"
      // On a phone the trash is an icon beside the title (LC33, after Todoist: the title, then the list).
      actionBeside
      // An act's page: its own title is the one in sight (LC29), not «Atti» over it.
      titleHidden={/^\/work\/atti\/./.test(pathname)}
      action={inView && (
        // On a phone a small framed button with the icon (LC38, Luca: «senza scritta. Basta ci metti il pulsante»): its frame
        // drawn 36 px inside the 44 px link, named «Cestino dei compiti»; from md the words in full.
        <Link to="/work/cestino" aria-label="Cestino dei compiti" className={cn(QUIET_BUTTON, 'mx-0 inline-flex items-center max-md:px-0 max-md:no-underline')}>
          <span className="inline-flex items-center gap-1.5 max-md:size-9 max-md:justify-center max-md:rounded-lg max-md:border max-md:border-slate-300 dark:max-md:border-slate-700">
            <Trash2 size={15} aria-hidden />
            <span aria-hidden className="max-md:hidden">Cestino dei compiti</span>
          </span>
        </Link>
      )}
    >
      <div className="flex w-full min-w-0 flex-col gap-4 max-md:-mt-3 max-md:gap-0">
        {/* Links, not `ui/SegmentedTabs` (buttons over one panel): each view has its address. Its look, the mark still. */}
        {/* LC27 (Luca, 15 Nov): the views' tabs stay at the top while the view scrolls, and a new view starts right under
            them, never with a jump to the page's top; it comes in with a short fade (none under reduced motion). */}
        <div ref={viewTop} aria-hidden />
        {(inView || inTrash) && (
          // On a phone the views are a bar at the screen's foot, where the thumb is (LC33, after Todoist's «In arrivo ·
          // Oggi · Prossime»); from md the tabs at the top, sticky.
          <div className={cn(
            'sticky top-0 z-10 -mx-2 bg-slate-50 px-2 py-2 dark:bg-slate-950',
            'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:z-30 max-md:mx-0 max-md:border-t max-md:border-slate-200 max-md:bg-card max-md:px-3 max-md:pb-[max(0.5rem,env(safe-area-inset-bottom))] max-md:pt-1.5 max-md:dark:border-slate-800',
          )}>
          <nav aria-label="Viste di Work" className="flex w-full gap-1 rounded-lg bg-slate-100 p-1 max-md:bg-transparent max-md:p-0 dark:bg-slate-800 max-md:dark:bg-transparent sm:w-fit">
            {VIEWS.map((view) => (
              <NavLink
                key={view.to}
                to={view.to}
                onClick={keepPlace}
                aria-label={view.label}
                className={({ isActive }) => cn(
                  'flex min-h-[44px] flex-1 items-center justify-center whitespace-nowrap rounded-md px-2 text-sm font-medium transition-colors sm:flex-none sm:px-4',
                  'max-md:flex-col max-md:gap-0.5 max-md:py-1.5 max-md:text-xs max-md:shadow-none',
                  FOCUS_RING,
                  isActive
                    ? 'bg-card text-slate-900 shadow-sm max-md:bg-ink-200 dark:bg-toga-400 dark:hover:bg-toga-300 dark:text-ink-950 max-md:dark:bg-ink-700 max-md:dark:text-slate-50'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                )}
              >
                <view.icon aria-hidden size={20} strokeWidth={1.75} className="md:hidden" />
                <span aria-hidden className="sm:hidden">{view.short}</span>
                <span aria-hidden className="hidden sm:inline">{view.label}</span>
              </NavLink>
            ))}
          </nav>
          </div>
        )}
        {/* At least a screen tall: a view that mounts empty while it loads never shortens the page under the reader. */}
        <div key={pathname} className={cn('min-h-[calc(100dvh-8rem)] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150', (inView || inTrash) && 'max-md:pb-24')}>
          <Outlet />
        </div>
      </div>
    </PageFrame>
  );
}
