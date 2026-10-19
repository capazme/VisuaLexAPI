import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import type { Materia } from '../../../types/studia';
import { MATERIA_LABEL } from './studiaLabels';
import { ConfettiBurst } from './progress/Celebration';
import { ProgressPanels, ProgressPanelsSkeleton } from './progress/ProgressPanels';
import { StudyStrip } from './progress/StudyStrip';
import { SubjectChips } from './progress/SubjectChips';
import { SubjectRoad, SubjectRoadSkeleton } from './progress/SubjectRoad';
import { TodayCard } from './progress/TodayCard';
import { useCelebratedToday } from './progress/useCelebratedToday';
import { useProgress } from './progress/useProgress';
import { PANEL_HEADING } from './progress/tokens';

const STORAGE_KEY = 'visualex.studia.ripasso.materia';
const MATERIE = Object.keys(MATERIA_LABEL) as Materia[];

/** The subject last chosen on this browser; a missing, unreadable or unknown value is «all subjects». */
function rememberedMateria(): Materia | undefined {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return MATERIE.find((materia) => materia === stored);
  } catch {
    return undefined;
  }
}

function rememberMateria(materia: Materia | undefined): void {
  try {
    if (materia) localStorage.setItem(STORAGE_KEY, materia);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or a full store: the choice lasts for this visit only.
  }
}

/**
 * «Oggi», Gymnasium's home (Gymnasium spec §5.1): the strip (streak, goal, the gear of the study
 * settings), the action (what is on today, what it costs, «Inizia»), «Cosa ripassi» (the subject chips,
 * which narrow the page and the session it starts), the road of subjects, and the progress at the
 * bottom («I tuoi progressi», until it has a page of its own). Everything comes from one read
 * (`useProgress`); the server decides what «today» is.
 */
export function ReviewHome() {
  const navigate = useNavigate();
  const [materia, setMateria] = useState<Materia | undefined>(rememberedMateria);
  const progress = useProgress(materia);
  const data = progress.data;
  const ringRef = useRef<HTMLDivElement>(null);
  const { celebratedBefore, markCelebrated } = useCelebratedToday();
  // The day whose burst has run its course on this page.
  const [burstDone, setBurstDone] = useState<string | null>(null);
  // Once a day (progress spec decision 10): here, when the goal was met today with some review and this browser had
  // not celebrated when the page opened (the session celebrates at the grade that closes it and marks the day the
  // same way). It follows the data on screen, not the read's status, so a new read halfway does not cut it short.
  const celebrate = data !== null && data.oggi.raggiunto && data.oggi.ripassi > 0 && !celebratedBefore(data.oggi.giorno) && burstDone !== data.oggi.giorno;

  const choose = (next: Materia | undefined) => {
    setMateria(next);
    rememberMateria(next);
  };
  const start = () => navigate(materia ? `/studia/ripasso/sessione?materia=${materia}` : '/studia/ripasso/sessione');
  const loading = progress.status === 'loading';

  return (
    // One column, at a reading measure; the progress at the bottom takes the width its calendar wants.
    <section className="max-w-5xl space-y-6 pb-8">
      <h2 className="sr-only">Oggi</h2>
      {/* The confetti start from the ring and fall over the strip and the action, never over the rest. */}
      <div className="relative max-w-3xl space-y-4">
        <StudyStrip data={data} loading={loading && data === null} onSettingsChanged={progress.reload} ringRef={ringRef} celebrate={celebrate} />
        <TodayCard data={data} failed={progress.status === 'error'} onRetry={progress.reload} filtered={materia !== undefined} onStart={start} celebrate={celebrate} />
        {celebrate && data && (
          <ConfettiBurst originRef={ringRef} onStart={() => markCelebrated(data.oggi.giorno)} onDone={() => setBurstDone(data.oggi.giorno)} />
        )}
      </div>

      <section aria-labelledby="studia-cosa" className="max-w-3xl space-y-3">
        <h3 id="studia-cosa" className={PANEL_HEADING}>
          Cosa ripassi
        </h3>
        <SubjectChips selected={materia} onSelect={choose} />
      </section>

      <div className={cn('space-y-6 transition-opacity', loading && data !== null && 'opacity-60')} aria-busy={loading}>
        <div className="max-w-3xl">
          {data ? <SubjectRoad materie={data.materie} selected={materia} /> : <SubjectRoadSkeleton pulsing={loading} />}
        </div>

        <section aria-labelledby="studia-progressi" className="space-y-4 border-t border-slate-200 pt-6 dark:border-slate-800">
          <h3 id="studia-progressi" className="font-serif text-xl text-slate-900 dark:text-slate-50">
            I tuoi progressi
          </h3>
          {data ? <ProgressPanels data={data} materia={materia} onSelectMateria={choose} /> : <ProgressPanelsSkeleton pulsing={loading} />}
        </section>
      </div>
    </section>
  );
}
