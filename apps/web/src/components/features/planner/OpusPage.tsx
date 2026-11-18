import { useLayoutEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { scrollParentOf } from '../practice/practiceView';
import { CalendarDays, CalendarCheck, Inbox, ListFilter, Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { pageName } from '../../../features/sections/pageNames';
import { PageFrame } from '../../layout/PageFrame';
import { MenuButton } from '../../ui/MenuButton';
import { QUIET_BUTTON } from '../studia/progress/tokens';
import { FOCUS_RING } from '../../../constants/interactions';
import { plannerStore } from './plannerStore';
import { setFootBarRoom } from '../../ui/notifications/footBar';

/** The planner's three views, tabs of the page since Work's bar lists only its five entries (D-315, LC8): the short
 *  word on a phone, where they are the bar at the foot, the full name from `md`, one name each (LC83). */
const VIEWS = [
  { to: '/work/scadenziario', label: 'Scadenziario', short: 'Scadenziario', icon: CalendarCheck },
  { to: '/work/prossimi', label: 'Prossimi giorni', short: 'Prossimi', icon: CalendarDays },
  { to: '/work/ingresso', label: "Lista d'ingresso", short: 'Ingresso', icon: Inbox },
];

/** Below `lg` a framed square with the icon, the words for a screen reader (LC38): at 768 px the title, the tabs and
 *  both options in words do not fit one row (LC83). From `lg` the words in full. */
const HEADER_BUTTON = cn(QUIET_BUTTON, 'mx-0 inline-flex items-center gap-1.5 max-lg:w-11 max-lg:justify-end max-lg:px-0 max-lg:no-underline');
const HEADER_ICON = 'inline-flex items-center max-lg:size-9 max-lg:justify-center max-lg:rounded-lg max-lg:border max-lg:border-slate-300 dark:max-lg:border-slate-700';

/** «Raggruppa: per data / per pratica», «Scadenziario»'s option, in the header beside the trash (LC83). */
function GroupingMenu() {
  const grouping = plannerStore((s) => s.grouping);
  const label = grouping === 'date' ? 'per data' : 'per pratica';
  return (
    <MenuButton
      label={`Raggruppa: ${label}`}
      triggerClassName={cn(HEADER_BUTTON, 'font-normal no-underline hover:no-underline hover:bg-slate-100 max-lg:hover:bg-transparent dark:hover:bg-slate-800')}
      items={(['date', 'dossier'] as const).map((choice) => ({
        label: choice === 'date' ? 'Per data' : 'Per pratica',
        checked: choice === grouping,
        onSelect: () => plannerStore.getState().setGrouping(choice),
      }))}
    >
      <span className={HEADER_ICON}><ListFilter size={15} aria-hidden /></span>
      <span className="max-lg:sr-only">Raggruppa: {label}</span>
    </MenuButton>
  );
}

/**
 * Opus's page (the planner): one compact header (LC83) — «Scadenze» once, its three views beside it as tabs
 * («Scadenziario», Opus's home, «Prossimi giorni», «Lista d'ingresso»), then «Raggruppa» and the trash on the same row;
 * from `md` it stays at the top while the view scrolls (LC27). On a phone the tabs are the bar at the screen's foot
 * (LC33) and the two options icons beside the title. «Dossier» stays an entry of Work. The tasks' trash is a view of
 * its own, under its own title: a task's trash is on the task, not among the dossiers' (`/api/trash`).
 */
export function OpusPage() {
  const { pathname } = useLocation();
  // The trash's link belongs to the three views; the tabs to them and to the trash, as its way back (#448). Neither on
  // the tools that are coming.
  const inView = VIEWS.some((view) => pathname.startsWith(view.to));
  const inTrash = pathname.startsWith('/work/cestino');
  const inboxCount = plannerStore((s) => s.inboxCount);
  const tabs = useRef<HTMLDivElement>(null);
  const tabsShown = inView || inTrash;
  // On a phone the views' bar is held at the screen's foot: its room there (its height and the safe area under it,
  // `footBarStore`), so the notifications rise over it and the page keeps both free (LC85, Papiniano on #585). From md
  // the bar is in the header: no room.
  useLayoutEffect(() => {
    const bar = tabs.current;
    if (!tabsShown || !bar) return;
    const measure = () => setFootBarRoom(getComputedStyle(bar).position === 'fixed'
      ? Math.max(0, Math.round(document.documentElement.clientHeight - bar.getBoundingClientRect().top))
      : 0);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(bar);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      setFootBarRoom(0);
    };
  }, [tabsShown]);
  /** Scrolled past the header, a change of view puts the scroller back where it sticks; above it, nothing moves. */
  const keepPlace = () => {
    // The frame's top, where the header sits before it sticks: the header itself reads where it is stuck.
    const mark = tabs.current?.closest<HTMLElement>('[data-page-width]');
    const scroller = mark ? scrollParentOf(mark) : null;
    if (!mark || !scroller) return;
    const stuckAt = mark.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    if (scroller.scrollTop > stuckAt) scroller.scrollTop = stuckAt;
  };
  return (
    <PageFrame
      // «Scadenze» over the three views; the trash and the tools that are coming keep their own name (L-37).
      title={inView ? 'Scadenze' : pageName(pathname) ?? 'Scadenze'}
      kicker="opus"
      section="opus"
      className="h-full"
      // On a phone the options are icons beside the title (LC33, after Todoist: the title, then the list).
      actionBeside
      headerClassName={(inView || inTrash) ? 'md:sticky md:top-[var(--phone-bar-offset,0px)] md:z-10 md:bg-slate-50 md:py-1.5 md:dark:bg-slate-950' : undefined}
      beside={(inView || inTrash) && (
        // Links, not `ui/SegmentedTabs` (buttons over one panel): each view has its address. On a phone the views are a
        // bar at the screen's foot, where the thumb is (LC33, after Todoist's «In arrivo · Oggi · Prossime»); from md
        // the tabs beside the title.
        <div
          ref={tabs}
          className={cn(
            'md:mr-auto',
            'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:border-t max-md:border-slate-200 max-md:bg-card max-md:px-3 max-md:pb-[max(0.5rem,env(safe-area-inset-bottom))] max-md:pt-1.5 max-md:dark:border-slate-800',
          )}
        >
          <nav aria-label="Viste di Work" className="flex w-full gap-1 rounded-lg bg-slate-100 p-1 max-md:bg-transparent max-md:p-0 dark:bg-slate-800 max-md:dark:bg-transparent md:w-fit">
            {VIEWS.map((view) => (
              <NavLink
                key={view.to}
                to={view.to}
                onClick={keepPlace}
                className={({ isActive }) => cn(
                  'flex min-h-[44px] flex-1 items-center justify-center whitespace-nowrap rounded-md px-2 text-sm font-medium transition-colors md:flex-none md:px-4',
                  'max-md:flex-col max-md:gap-0.5 max-md:py-1.5 max-md:text-xs max-md:shadow-none',
                  FOCUS_RING,
                  isActive
                    ? 'bg-card text-slate-900 shadow-sm max-md:bg-ink-200 dark:bg-toga-400 dark:hover:bg-toga-300 dark:text-ink-950 max-md:dark:bg-ink-700 max-md:dark:text-slate-50'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                )}
              >
                <view.icon aria-hidden size={20} strokeWidth={1.75} className="md:hidden" />
                <span className="inline-flex items-baseline">
                  {/* One name at each width: the other is `display: none`, so a screen reader reads one too. */}
                  <span className="md:hidden">{view.short}</span>
                  <span className="hidden md:inline">{view.label}</span>
                  {/* The inbox's count, the one view with no group to carry it (LC83). */}
                  {view.to === '/work/ingresso' && pathname.startsWith(view.to) && inboxCount !== null && inboxCount > 0 && (
                    <span data-tab-count className="ml-1.5 font-normal tabular-nums opacity-75">
                      <span className="sr-only">, </span>
                      {inboxCount}
                      <span className="sr-only">{inboxCount === 1 ? ' compito' : ' compiti'}</span>
                    </span>
                  )}
                </span>
              </NavLink>
            ))}
          </nav>
        </div>
      )}
      action={inView && (<>
        {pathname.startsWith('/work/scadenziario') && <GroupingMenu />}
        <Link to="/work/cestino" aria-label="Cestino dei compiti" className={HEADER_BUTTON}>
          <span className={HEADER_ICON}>
            <Trash2 size={15} aria-hidden />
          </span>
          <span aria-hidden className="max-lg:hidden">Cestino</span>
        </Link>
      </>)}
    >
      {/* At least a screen tall: a view that mounts empty while it loads never shortens the page under the reader. It
          comes in with a short fade (none under reduced motion). */}
      <div key={pathname} className={cn('min-h-[calc(100dvh-8rem)] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150', (inView || inTrash) && 'max-md:pb-24')}>
        <Outlet />
      </div>
    </PageFrame>
  );
}
