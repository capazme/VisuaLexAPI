import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, GraduationCap } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { studiaService } from '../../../services/studiaService';
import { isStudiaEnabled } from '../../../features/studia/featureFlag';
import { FOCUS_RING } from '../studia/progress/tokens';
import { plannerStore } from './plannerStore';
import { studyLine } from './taskDates';

/**
 * Gymnasium's day inside «Oggi» (P2b): one line, read only — «Gymnasium: 12 da ripassare, 8 nuove · circa 7
 * minuti» — that opens Gymnasium's «Oggi». It is not a task: nothing is stored, nothing is ticked here. Read from
 * Gymnasium's own session (`/lingo/srs/sessione`) when the view mounts and on a new day; absent when Gymnasium is
 * off, when there is nothing to review, or when the read fails (logged by its status).
 */
export function StudyTodayRow() {
  const day = plannerStore((s) => s.today);
  const [counts, setCounts] = useState<{ due: number; fresh: number } | null>(null);
  const enabled = isStudiaEnabled();

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    studiaService.session().then(
      (session) => {
        if (live) setCounts({ due: session.conteggi.dovute, fresh: session.conteggi.nuove });
      },
      (error: { status?: number }) => console.warn("[planner] Gymnasium's day could not be read", error?.status ?? 'no answer'),
    );
    return () => {
      live = false;
    };
  }, [enabled, day]);

  if (!counts || counts.due + counts.fresh === 0) return null;
  return (
    <Link
      to="/studia/ripasso"
      className={cn(
        'flex min-h-[44px] min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 hover:border-primary-300 hover:bg-primary-50/40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-primary-700 dark:hover:bg-primary-900/20',
        FOCUS_RING,
      )}
    >
      <GraduationCap size={18} aria-hidden className="shrink-0 text-primary-700 dark:text-primary-300" />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{studyLine(counts.due, counts.fresh)}</span>
      <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-500" />
    </Link>
  );
}
