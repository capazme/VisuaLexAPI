import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { useMediaQuery } from '../../../hooks/useIsDesktop';
import type { Materia } from '../../../types/studia';
import { MATERIA_LABEL } from './studiaLabels';
import { MissionList } from './missions/MissionList';
import { TodayMissions } from './missions/TodayMissions';
import { ConfettiBurst } from './progress/Celebration';
import { STUDY_SETTINGS_PANEL, StatsBand } from './progress/StatsBand';
import { SubjectChips } from './progress/SubjectChips';
import { SubjectRoad, SubjectRoadSkeleton, SubjectRoadUnread } from './progress/SubjectRoad';
import { rememberedMateria, rememberMateria } from './progress/rememberedSubject';
import { useCelebratedToday } from './progress/useCelebratedToday';
import { usePercorso } from './progress/usePercorso';
import { useProgress } from './progress/useProgress';
import { BLOCK_HEADING } from './progress/tokens';

/**
 * «Oggi», Gymnasium's home (Gymnasium spec §5.1), in the sections' full-width frame, in the order the owner fixed: today's missions (the first carries
 * «Inizia»), the statistics (streak, goal, the current week, the cards by state; «Tutti i progressi» leads to
 * `/studia/progressi`), the full list of missions, then «Cosa ripassi» (the subject chips) and the road. The missions
 * and the statistics are the whole day's (`useProgress(undefined)`); a subject chosen narrows the first mission's
 * action and the session it starts, through a second read made only while one is chosen. The road's institutes and the cards due by
 * subject come from a third, `usePercorso` (G5), on which nothing above the road waits. The server decides what
 * «today» is.
 */
/**
 * From `xl` two columns (G6), seven twelfths and five: the grid, the left column's place, the right column's (the band
 * and the subject chips, sticky over every row) and the confetti's box over the first row of both. Applied only out of
 * Focus mode, which narrows the frame to 896 px: there the band would be too narrow for the week. The left holds three
 * rows (missions, list, road); the fourth, `1fr`, takes what the right column has beyond them.
 */
const SPLIT = 'xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:grid-rows-[auto_auto_auto_1fr] xl:pb-0';
/** Tailwind's `xl`: from here «Cosa ripassi» is drawn in the right column, under the band. */
const XL = '(min-width: 1280px)';
const LEFT = 'xl:col-start-1';
const BAND = 'xl:col-start-2 xl:row-span-full xl:mt-0 xl:self-start';
/** Sticky only while the settings are closed: open, the column may be taller than the window, and its foot must scroll into reach. */
const STICK = 'xl:sticky xl:top-8';
const BURST = 'xl:col-span-full xl:row-end-2';

export function ReviewHome() {
  const navigate = useNavigate();
  const split = !useAppStore((s) => s.settings.focusMode);
  // The chips move, not their copy: one place or the other, so the document never holds them twice.
  const wide = useMediaQuery(XL);
  const chipsBeside = split && wide;
  const [materia, setMateria] = useState<Materia | undefined>(rememberedMateria);
  const day = useProgress(undefined);
  const narrowed = useProgress(materia, materia !== undefined);
  const percorso = usePercorso();
  const action = materia ? narrowed : day;
  const data = day.data;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [communityRequest, setCommunityRequest] = useState(0);
  // A mission's «Cambia…» opens the settings and takes the reader there: the panel takes the focus once drawn.
  const [focusSettings, setFocusSettings] = useState(0);
  useEffect(() => {
    if (focusSettings === 0) return;
    const frame = requestAnimationFrame(() => document.getElementById(STUDY_SETTINGS_PANEL)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusSettings]);
  const openSettingsFor = (target?: 'comunita') => {
    if (target === 'comunita') setCommunityRequest((n) => n + 1);
    setSettingsOpen(true);
    setFocusSettings((n) => n + 1);
  };
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

  // «Cosa ripassi»: after the list up to `xl`, in the reading order the owner fixed; from `xl` under the band, where
  // the right column had room and the left a long page (G6).
  const subjects = (
    <section aria-labelledby="studia-cosa" className="min-w-0 space-y-3">
      <h3 id="studia-cosa" className={BLOCK_HEADING}>
        Cosa ripassi
      </h3>
      <SubjectChips selected={materia} onSelect={choose} />
    </section>
  );

  return (
    // One column on a phone and a tablet; from `xl` two (G6): the missions, the list, the chips and the road on the
    // left, two thirds, and the statistics on the right, kept in sight under the heading while the page scrolls. The
    // document's order stays the reading order the owner fixed — missions, statistics, list — so a screen reader and
    // the keyboard meet the band second on every width; the grid places it. The fifth row, `1fr`, takes what the band
    // has beyond the left column, so a short left column never stretches its own rows.
    <section className={cn('relative grid gap-8 pb-8', split && SPLIT)}>
      <h2 className="sr-only">Oggi</h2>
      <div className={cn('min-w-0', split && LEFT)}>
        <TodayMissions
          day={data}
          dayFailed={day.status === 'error'}
          action={action.data}
          actionFailed={action.status === 'error'}
          onRetry={reload}
          subject={subject}
          onAllSubjects={() => choose(undefined)}
          onStart={start}
          onOpenSettings={openSettingsFor}
          settingsPanel={STUDY_SETTINGS_PANEL}
          celebrate={celebrate}
          stampRef={stampRef}
        />
      </div>
      {/* Under the missions on a phone, 16 px apart as before; beside everything from `xl`, sticky, with the chips. */}
      <div className={cn('-mt-4 min-w-0', split && BAND, split && !settingsOpen && STICK)}>
        <StatsBand
          aside={split}
          data={data}
          loading={loading && data === null}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((open) => !open)}
          onCloseSettings={() => setSettingsOpen(false)}
          onSettingsChanged={reload}
          communityRequest={communityRequest}
          celebrate={celebrate}
        />
        {chipsBeside && <div className="mt-8">{subjects}</div>}
      </div>
      {/* The confetti start from the stamp, in the goal's row, and fall over the missions and the statistics, never
          further: an absolute box placed on their rows (the grid's area is its containing block), out of the flow, so
          mounting it moves nothing. */}
      {celebrate && data && (
        <div aria-hidden className={cn('pointer-events-none absolute inset-0 col-start-1 row-start-1 row-end-3', split && BURST)}>
          <ConfettiBurst originRef={stampRef} onStart={() => markCelebrated(data.oggi.giorno)} onDone={() => setBurstDone(data.oggi.giorno)} />
        </div>
      )}

      <div className={cn('min-w-0 empty:hidden', split && LEFT)}>
        <MissionList data={data} loading={loading && data === null} />
      </div>

      {!chipsBeside && subjects}

      <div className={cn('min-w-0 transition-opacity', split && LEFT, loading && data !== null && 'opacity-60')} aria-busy={loading}>
        {data ? (
          <SubjectRoad materie={data.materie} selected={materia} percorso={percorso} onRetryPercorso={percorso.reload} />
        ) : loading ? (
          <SubjectRoadSkeleton />
        ) : (
          <SubjectRoadUnread />
        )}
      </div>
    </section>
  );
}
