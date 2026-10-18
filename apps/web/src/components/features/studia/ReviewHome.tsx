import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import type { Materia } from '../../../types/studia';
import { MATERIA_LABEL } from './studiaLabels';
import { StudyPreferences } from './StudyPreferences';
import { ProgressBand } from './progress/ProgressBand';
import { ProgressPanels, ProgressPanelsSkeleton } from './progress/ProgressPanels';
import { SubjectChips } from './progress/SubjectChips';
import { useCelebratedToday } from './progress/useCelebratedToday';
import { useProgress } from './progress/useProgress';
import { FOCUS_RING } from './progress/tokens';

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
 * «Ripasso», Studia's home (Studia progress spec §6.2, direction D): the band with today's goal, the streak
 * and «Inizia il ripasso»; the subject chips, which narrow the dashboard and the session it starts; the
 * activity calendar, the cards by state, the coming days and the subjects; the study settings closed at
 * the bottom. Everything comes from one read (`useProgress`); the server decides what «today» is.
 */
export function ReviewHome() {
  const navigate = useNavigate();
  const [materia, setMateria] = useState<Materia | undefined>(rememberedMateria);
  const progress = useProgress(materia);
  const data = progress.data;
  const { celebratedBefore, markCelebrated } = useCelebratedToday();
  // The day whose burst has run its course on this page.
  const [burstDone, setBurstDone] = useState<string | null>(null);
  // Once a day (spec decision 10): here, when the goal was met today with some review and this browser had not
  // celebrated when the page opened (the session celebrates at the grade that closes it and marks the day the
  // same way). It follows the data on screen, not the read's status, so a new read halfway does not cut it short.
  const celebrate = data !== null && data.oggi.raggiunto && data.oggi.ripassi > 0 && !celebratedBefore(data.oggi.giorno) && burstDone !== data.oggi.giorno;

  const choose = (next: Materia | undefined) => {
    setMateria(next);
    rememberMateria(next);
  };
  const nothingLeft = progress.status === 'ready' && progress.data.oggi.dovute === 0 && progress.data.oggi.nuove === 0;
  const start = () => navigate(materia ? `/studia/ripasso/sessione?materia=${materia}` : '/studia/ripasso/sessione');

  return (
    <section className="max-w-5xl space-y-5 pb-8">
      <h2 className="sr-only">Ripasso</h2>
      <ProgressBand
        data={data}
        failed={progress.status === 'error'}
        filtered={materia !== undefined}
        onStart={start}
        nothingLeft={nothingLeft}
        celebrate={celebrate}
        onCelebrationStart={() => data && markCelebrated(data.oggi.giorno)}
        onCelebrated={() => data && setBurstDone(data.oggi.giorno)}
      />
      {progress.status === 'error' && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Non riesco a leggere i tuoi progressi.{' '}
          <button type="button" onClick={progress.reload} className={cn('min-h-[44px] rounded px-1 font-medium underline md:min-h-0', FOCUS_RING)}>
            Riprova
          </button>
        </p>
      )}
      <SubjectChips selected={materia} onSelect={choose} />
      {data ? (
        <div className={cn('space-y-4 transition-opacity', progress.status === 'loading' && 'opacity-60')} aria-busy={progress.status === 'loading'}>
          <ProgressPanels data={data} materia={materia} onSelectMateria={choose} />
        </div>
      ) : (
        <ProgressPanelsSkeleton pulsing={progress.status === 'loading'} />
      )}
      <StudyPreferences onChanged={progress.reload} />
    </section>
  );
}
