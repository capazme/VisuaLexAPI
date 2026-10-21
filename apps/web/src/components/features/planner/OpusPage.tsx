import { Link, Outlet, useLocation } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { SECTION_TITLES } from '../../../features/sections/sections';
import { PageFrame } from '../../layout/PageFrame';
import { QUIET_BUTTON } from '../studia/progress/tokens';

/**
 * Opus's page (the planner, wave 1): the section's title, «Opus: la tua officina giuridica», over its views —
 * «Oggi» (Opus's home), «Prossimi giorni», «Lista d'ingresso» — which are the sidebar's entries in this section, as
 * Gymnasium's are; «Dossier» stays an entry of Opus. In the sections' frame (`PageFrame`, W2), its title the one the
 * section switcher focuses (T1); the views keep a column at a reading measure. The tasks' trash is a view of its
 * own: a task's trash is on the task, not among the dossiers' (`/api/trash`).
 */
export function OpusPage() {
  const inTrash = useLocation().pathname.startsWith('/opus/cestino');
  return (
    <PageFrame
      title={SECTION_TITLES.opus}
      section="opus"
      className="h-full"
      action={!inTrash && (
        <Link to="/opus/cestino" className={cn(QUIET_BUTTON, 'mx-0 inline-flex items-center gap-1.5')}>
          <Trash2 size={15} aria-hidden />
          Cestino dei compiti
        </Link>
      )}
    >
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <Outlet />
      </div>
    </PageFrame>
  );
}
