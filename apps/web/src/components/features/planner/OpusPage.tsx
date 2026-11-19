import { useLayoutEffect, useRef } from 'react';
import { Link, useLocation, useOutlet } from 'react-router-dom';
import { scrollParentOf } from '../practice/practiceView';
import { CalendarDays, CalendarCheck, Inbox, Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { pageName } from '../../../features/sections/pageNames';
import { PageFrame } from '../../layout/PageFrame';
import { ViewSlide } from '../../layout/ViewSlide';
import { SegmentedTabLinks } from '../../ui/SegmentedTabs';
import { buttonClassName } from '../../ui/buttonStyles';
import { plannerStore } from './plannerStore';
import { setFootBarRoom } from '../../ui/notifications/footBar';
import { TASK_BASE, TaskSectionContext, type TaskSection } from './taskSection';

/** The planner's three views, tabs of the page since Work's bar lists only its five entries (D-315, LC8): the short
 *  word on a phone, where they are the bar at the foot, the full name from `md`, one name each (LC83). */
const VIEWS = [
  { path: 'scadenziario', label: 'Scadenziario', short: 'Scadenziario', icon: CalendarCheck },
  { path: 'prossimi', label: 'Prossimi giorni', short: 'Prossimi', icon: CalendarDays },
  { path: 'ingresso', label: "Lista d'ingresso", short: 'Ingresso', icon: Inbox },
];

/** The views in the tabs' order, the trash after them (its way back is the tabs): the order of their slide (LC98). */
const VIEW_ORDER = [...VIEWS.map((view) => view.path), 'cestino'];

/** `Button variant="secondary"`'s look (LC110). Below `lg` `IconButton`'s square with the icon, the words for a screen
 *  reader (LC38): at 768 px the title, the tabs and both options in words do not fit one row (LC83). From `lg` the
 *  words in full. */
const HEADER_BUTTON = cn(buttonClassName('secondary'), 'max-lg:min-w-11 max-lg:px-0 md:max-lg:min-w-9');

/**
 * Opus's page (the planner): one compact header (LC83) — «Attività» once with the trash on its row, its three views
 * under it as tabs (LC130: «Scadenziario», Opus's home, «Prossimi giorni», «Lista d'ingresso»; «Raggruppa» is in
 * «Scadenziario» itself, over its rows);
 * from `md` it stays at the top while the view scrolls (LC27). On a phone the tabs are the bar at the screen's foot
 * (LC33) and the trash an icon beside the title. «Dossier» stays an entry of Work. The tasks' trash is a view of
 * its own, under its own title: a task's trash is on the task, not among the dossiers' (`/api/trash`).
 */
export function OpusPage() {
  const { pathname } = useLocation();
  const outlet = useOutlet();
  // Learn has the same page at `/learn/attivita` (LC130), with its own tasks: the «studio» ones (`taskSection.ts`).
  const section: TaskSection = pathname === TASK_BASE.learn || pathname.startsWith(`${TASK_BASE.learn}/`) ? 'learn' : 'work';
  const base = TASK_BASE[section];
  // The view's segment under the section's base: «scadenziario», «cestino», a tool that is coming.
  const viewPath = pathname.slice(base.length + 1).split('/')[0] ?? '';
  // The trash's link belongs to the three views; the tabs to them and to the trash, as its way back (#448). Neither on
  // the tools that are coming.
  const inView = VIEWS.some((view) => view.path === viewPath);
  const inTrash = viewPath === 'cestino';
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
      // «Attività» over the three views (LC130); the trash and the tools that are coming keep their own name (L-37).
      title={inView ? 'Attività' : pageName(pathname) ?? 'Attività'}
      kicker={section === 'learn' ? 'gymnasium' : 'opus'}
      section={section === 'learn' ? 'gymnasium' : 'opus'}
      className="h-full"
      // On a phone the options are icons beside the title (LC33, after Todoist: the title, then the list).
      actionBeside
      headerClassName={(inView || inTrash) ? 'md:flex-wrap md:gap-y-3 md:sticky md:top-[var(--phone-bar-offset,0px)] md:z-10 md:bg-slate-50 md:py-1.5 md:dark:bg-slate-950' : undefined}
      beside={(inView || inTrash) && (
        // `SegmentedTabLinks` (LC110): each view has its address. On a phone the views are a bar at the screen's foot,
        // where the thumb is (LC33, after Todoist's «In arrivo · Oggi · Prossime»); from md a row of their own under the
        // title and the trash (LC130).
        <div
          ref={tabs}
          className={cn(
            'md:order-last md:basis-full',
            'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:border-t max-md:border-slate-200 max-md:bg-card max-md:px-3 max-md:pb-[max(0.5rem,env(safe-area-inset-bottom))] max-md:pt-1.5 max-md:dark:border-slate-800',
          )}
        >
          <SegmentedTabLinks
            label={section === 'learn' ? 'Viste di Learn' : 'Viste di Work'}
            size="sm"
            footBar
            onNavigate={keepPlace}
            className="w-full md:w-fit"
            // 13 px from md, as the section tabs; 12 under the icons of the bar at the foot (the consultant, LC111).
            tabClassName="whitespace-nowrap md:px-4 md:text-[13px]"
            links={VIEWS.map((view) => ({
              to: `${base}/${view.path}`,
              icon: <view.icon size={20} strokeWidth={1.75} />,
              label: (
                <span className="inline-flex items-baseline">
                  {/* One name at each width: the other is `display: none`, so a screen reader reads one too. */}
                  <span className="md:hidden">{view.short}</span>
                  <span className="hidden md:inline">{view.label}</span>
                  {/* The inbox's count, the one view with no group to carry it (LC83). */}
                  {view.path === 'ingresso' && viewPath === 'ingresso' && inboxCount !== null && inboxCount > 0 && (
                    <span data-tab-count className="ml-1.5 font-normal tabular-nums opacity-75">
                      <span className="sr-only">, </span>
                      {inboxCount}
                      <span className="sr-only">{inboxCount === 1 ? ' compito' : ' compiti'}</span>
                    </span>
                  )}
                </span>
              ),
            }))}
          />
        </div>
      )}
      action={inView && (<>
        <Link to={`${base}/cestino`} aria-label="Cestino dei compiti" className={HEADER_BUTTON}>
          <Trash2 size={15} aria-hidden />
          <span aria-hidden className="max-lg:hidden">Cestino</span>
        </Link>
      </>)}
    >
      {/* At least a screen tall: a view that mounts empty while it loads never shortens the page under the reader. It
          slides in from the side of its tab (LC98). */}
      <ViewSlide view={viewPath} order={VIEW_ORDER}>
        <div className={cn('min-h-[calc(100dvh-8rem)]', (inView || inTrash) && 'max-md:pb-24')}>
          <TaskSectionContext.Provider value={section}>{outlet}</TaskSectionContext.Provider>
        </div>
      </ViewSlide>
    </PageFrame>
  );
}
