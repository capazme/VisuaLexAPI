import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { pageName } from '../../../features/sections/pageNames';
import { PageFrame } from '../../layout/PageFrame';
import { QUIET_BUTTON } from '../studia/progress/tokens';
import { FOCUS_RING } from '../../../constants/interactions';

/** The planner's three views, tabs of the page since Work's bar lists only its five entries (D-315, LC8): the short
 *  word on a phone, as the Forum's tabs, so the three share a 320 px row. */
const VIEWS = [
  { to: '/work/oggi', label: 'Oggi', short: 'Oggi' },
  { to: '/work/prossimi', label: 'Prossimi giorni', short: 'Prossimi' },
  { to: '/work/ingresso', label: "Lista d'ingresso", short: 'Ingresso' },
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
  // The tabs and the trash belong to the three views: not on the trash itself, nor on Atti and Anonimizzatore.
  const inView = VIEWS.some((view) => pathname.startsWith(view.to));
  return (
    <PageFrame
      // The view's name, from the one list of the pages' names (L-37).
      title={pageName(pathname) ?? 'Oggi'}
      kicker="opus"
      section="opus"
      className="h-full"
      action={inView && (
        <Link to="/work/cestino" className={cn(QUIET_BUTTON, 'mx-0 inline-flex items-center gap-1.5')}>
          <Trash2 size={15} aria-hidden />
          Cestino dei compiti
        </Link>
      )}
    >
      <div className="flex w-full min-w-0 flex-col gap-4">
        {/* Links, not `ui/SegmentedTabs` (buttons over one panel): each view has its address. Its look, the mark still. */}
        {inView && (
          <nav aria-label="Viste di Work" className="flex w-full gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800 sm:w-fit">
            {VIEWS.map((view) => (
              <NavLink
                key={view.to}
                to={view.to}
                aria-label={view.label}
                className={({ isActive }) => cn(
                  'flex min-h-[44px] flex-1 items-center justify-center whitespace-nowrap rounded-md px-2 text-sm font-medium transition-colors sm:flex-none sm:px-4',
                  FOCUS_RING,
                  isActive
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                )}
              >
                <span aria-hidden className="sm:hidden">{view.short}</span>
                <span aria-hidden className="hidden sm:inline">{view.label}</span>
              </NavLink>
            ))}
          </nav>
        )}
        <Outlet />
      </div>
    </PageFrame>
  );
}
