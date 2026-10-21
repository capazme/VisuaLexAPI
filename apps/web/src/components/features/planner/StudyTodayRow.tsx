import { Link } from 'react-router-dom';
import { ChevronRight, GraduationCap } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { isStudiaEnabled } from '../../../features/studia/featureFlag';
import { FOCUS_RING } from '../studia/progress/tokens';

/**
 * Gymnasium's day inside «Oggi» (P2b): one line, read only, that opens Gymnasium's «Oggi». It is not a task: nothing
 * is stored, nothing is ticked here. It carries no counts and reads nothing: Gymnasium's session and progress reads
 * mark the day and settle the missions when the queue is done (`apps/server/src/routes/lingoSrs.ts`), and opening
 * Opus must not count toward Gymnasium's streak. The counts come back with a read that only counts. Absent when
 * Gymnasium is off.
 */
export function StudyTodayRow() {
  if (!isStudiaEnabled()) return null;
  return (
    <Link
      to="/studia/ripasso"
      className={cn(
        'flex min-h-[44px] min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 hover:border-primary-300 hover:bg-primary-50/40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-primary-700 dark:hover:bg-primary-900/20',
        FOCUS_RING,
      )}
    >
      <GraduationCap size={18} aria-hidden className="shrink-0 text-primary-700 dark:text-primary-300" />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">Gymnasium: il ripasso di oggi</span>
      <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-500" />
    </Link>
  );
}
