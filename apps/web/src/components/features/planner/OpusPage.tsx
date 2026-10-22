import { Link, Outlet, useLocation } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { pageName } from '../../../features/sections/pageNames';
import { PageFrame } from '../../layout/PageFrame';
import { QUIET_BUTTON } from '../studia/progress/tokens';

/**
 * Opus's page (the planner, wave 1): the view's name as the title, the section's phrase over it (L-37), over its views —
 * «Oggi» (Opus's home), «Prossimi giorni», «Lista d'ingresso» — which are the sidebar's entries in this section, as
 * Gymnasium's are; «Dossier» stays an entry of Opus. In the sections' frame (`PageFrame`, W2), its title the one the
 * section switcher focuses (T1); the views take the frame's width, the lists' rows with room for the dossier at their
 * right end (P2b). The tasks' trash is a view of its
 * own: a task's trash is on the task, not among the dossiers' (`/api/trash`).
 */
export function OpusPage() {
  const { pathname } = useLocation();
  const inTrash = pathname.startsWith('/opus/cestino');
  return (
    <PageFrame
      // The view's name, from the one list of the pages' names (L-37).
      title={pageName(pathname) ?? 'Oggi'}
      kicker="opus"
      section="opus"
      className="h-full"
      action={!inTrash && (
        <Link to="/opus/cestino" className={cn(QUIET_BUTTON, 'mx-0 inline-flex items-center gap-1.5')}>
          <Trash2 size={15} aria-hidden />
          Cestino dei compiti
        </Link>
      )}
    >
      <div className="flex w-full min-w-0 flex-col gap-4">
        <Outlet />
      </div>
    </PageFrame>
  );
}
