import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { cn } from '../../../../lib/utils';
import { loadAssistantFeatures } from '../../../../store/assistantProposals';
import { MUTED_TEXT, SECONDARY_BUTTON } from '../progress/tokens';
import { useCoursesSwitch } from './coursesSwitch';

/**
 * «Percorsi»'s pages only while the switch `lingo_courses` is on (courses spec §10.10). The features are read again as a
 * page mounts, since an administrator may have switched it either way meanwhile: an «off» known from before waits for
 * that read, and only an «off» it confirms goes back to «Oggi», so with the switch off nothing of the courses appears.
 * A switch that could not be read at all says so, with «Riprova».
 */
export function CoursesGate({ children }: { children: ReactNode }) {
  const state = useCoursesSwitch();
  const [reads, setReads] = useState(0);
  const [settled, setSettled] = useState(-1);
  useEffect(() => {
    let live = true;
    void loadAssistantFeatures().finally(() => {
      if (live) setSettled(reads);
    });
    return () => {
      live = false;
    };
  }, [reads]);
  const read = settled === reads;
  if (state === 'on') return <>{children}</>;
  if (state === 'off' && read) return <Navigate to="/studia/ripasso" replace />;
  if (state === 'unknown' && read) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
        <p className="min-w-0 flex-1 basis-60">Non è stato possibile sapere se i percorsi sono disponibili: forse sei offline.</p>
        <button type="button" onClick={() => setReads((n) => n + 1)} className={SECONDARY_BUTTON}>
          Riprova
        </button>
      </div>
    );
  }
  return (
    <p role="status" className={cn('text-sm', MUTED_TEXT)}>
      Caricamento…
    </p>
  );
}
