import { useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import type { Materia } from '../../../types/studia';
import { MATERIA_LABEL } from './studiaLabels';
import type { StudiaOutletContext } from './StudiaPage';
import { MissionList } from './missions/MissionList';
import { TodayMissions } from './missions/TodayMissions';
import { ConfettiBurst } from './progress/Celebration';
import { MonthSheet } from './progress/MonthSheet';
import { StatsBand } from './progress/StatsBand';
import { StudySettingsSheet } from './progress/StudySettings';
import { SubjectChips } from './progress/SubjectChips';
import { SubjectRoad, SubjectRoadSkeleton, SubjectRoadUnread } from './progress/SubjectRoad';
import { useCelebratedToday } from './progress/useCelebratedToday';
import { usePercorso } from './progress/usePercorso';
import { useProgress } from './progress/useProgress';
import { BLOCK_HEADING, subjectHue } from './progress/tokens';

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
 * «Oggi», Gymnasium's home (Gymnasium spec §5.1), in the order the owner fixed: today's missions (the first carries
 * «Inizia»), the statistics (streak, goal, the current week, the cards by state; «Il tuo mese» in a sheet), the full
 * list of missions, then «Cosa ripassi» (the subject chips) and the road. The missions and the statistics are the
 * whole day's (`useProgress(undefined)`); a subject chosen narrows the first mission's action, the session it starts
 * and «Il tuo mese», through a second read made only while one is chosen. The road's institutes and the cards due by
 * subject come from a third, `usePercorso` (G5), on which nothing above the road waits. The server decides what
 * «today» is.
 */
export function ReviewHome() {
  const navigate = useNavigate();
  const validator = useOutletContext<StudiaOutletContext | undefined>()?.validator === true;
  const [materia, setMateria] = useState<Materia | undefined>(rememberedMateria);
  const day = useProgress(undefined);
  const narrowed = useProgress(materia, materia !== undefined);
  const percorso = usePercorso();
  const action = materia ? narrowed : day;
  const data = day.data;
  const [sheet, setSheet] = useState<'settings' | 'month' | null>(null);
  const stampRef = useRef<HTMLDivElement>(null);
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
  const reload = () => {
    day.reload();
    narrowed.reload();
    percorso.reload();
  };
  const start = () => navigate(materia ? `/studia/ripasso/sessione?materia=${materia}` : '/studia/ripasso/sessione');
  const loading = day.status === 'loading';
  const subject = materia && MATERIA_LABEL[materia];

  return (
    // One column at a reading measure, centred with the area's heading (`StudiaPage`).
    <section className="space-y-8 pb-8">
      <h2 className="sr-only">Oggi</h2>
      {/* The confetti start from the stamp, in the goal's row, and fall over the missions and the statistics, never further. */}
      {/* A grid, not `space-y`: the burst mounted after the band would give it a margin and move the page. */}
      <div className="relative grid gap-4">
        <TodayMissions
          day={data}
          dayFailed={day.status === 'error'}
          action={action.data}
          actionFailed={action.status === 'error'}
          onRetry={reload}
          subject={subject}
          onAllSubjects={() => choose(undefined)}
          onStart={start}
          onOpenSettings={() => setSheet('settings')}
          celebrate={celebrate}
          stampRef={stampRef}
        />
        <StatsBand
          data={data}
          loading={loading && data === null}
          settingsOpen={sheet === 'settings'}
          onOpenSettings={() => setSheet('settings')}
          monthOpen={sheet === 'month'}
          onOpenMonth={() => setSheet('month')}
          celebrate={celebrate}
        />
        {celebrate && data && (
          <ConfettiBurst originRef={stampRef} onStart={() => markCelebrated(data.oggi.giorno)} onDone={() => setBurstDone(data.oggi.giorno)} />
        )}
      </div>

      <MissionList data={data} loading={loading && data === null} validator={validator} />

      <section aria-labelledby="studia-cosa" className="space-y-3">
        <h3 id="studia-cosa" className={BLOCK_HEADING}>
          Cosa ripassi
        </h3>
        <SubjectChips selected={materia} onSelect={choose} />
      </section>

      <div className={cn('transition-opacity', loading && data !== null && 'opacity-60')} aria-busy={loading}>
        {data ? (
          <SubjectRoad materie={data.materie} selected={materia} percorso={percorso} onRetryPercorso={percorso.reload} />
        ) : loading ? (
          <SubjectRoadSkeleton />
        ) : (
          <SubjectRoadUnread />
        )}
      </div>

      {sheet === 'settings' && <StudySettingsSheet onClose={() => setSheet(null)} onChanged={reload} />}
      {/* The subject's read, once it has answered; the day's until then. */}
      {sheet === 'month' && (action.data ?? data) && (
        <MonthSheet
          data={(action.data ?? data)!}
          subject={action.data ? subject : undefined}
          hue={materia && action.data ? subjectHue(materia) : undefined}
          onClose={() => setSheet(null)}
        />
      )}
    </section>
  );
}
