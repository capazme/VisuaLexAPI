import { useEffect, useRef, useState, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import { DayBlock } from './missions/DayBlock';
import { MissionList } from './missions/MissionList';
import { TodayMissions } from './missions/TodayMissions';
import { goalMissionDone } from './missions/missions';
import { SmokeRise } from './progress/Celebration';
import { STUDY_SETTINGS_PANEL, StatsBand } from './progress/StatsBand';
import { useCelebratedToday } from './progress/useCelebratedToday';
import { usePercorso } from './progress/usePercorso';
import { LearnPath } from './progress/LearnPath';
import { useProgress } from './progress/useProgress';
import { TodayCourses } from './corsi/TodayCourses';
import { TodayExam } from './corsi/TodayExam';

/**
 * «Oggi», Learn's home (LC23, after Duolingo's: Luca, 15 November): the day block first (what is on today and «Inizia il
 * ripasso», the page's one action), then «Il tuo sentiero» (LC62), a unit per subject with its institutes as stops, and the full
 * list of missions; beside it from `lg` the day's numbers, the streak and the level, then today's missions. The missions
 * and the statistics are the whole day's (`useProgress(undefined)`); the road is `usePercorso` (G5), on which nothing
 * above waits. The server decides what «today» is.
 *
 * From `lg` two columns, the road and a 20 rem rail (22 from `xl`): the day block on the first row, the road and the list
 * on the second, the rail across both, sticky while it fits. On a phone one column in the document's order: the day, the
 * rail, the road, the list.
 */
const SPLIT = 'lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr] lg:gap-x-10 xl:grid-cols-[minmax(0,1fr)_22rem]';
const LEFT = 'lg:col-start-1 lg:row-start-1';
const ASIDE = 'lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start';
/**
 * Sticky under the heading (G6), so the right column never leaves the page empty under it (G8) — while it fits in the
 * window and the settings are closed: taller, its foot must scroll into reach.
 */
const STICK = 'lg:sticky lg:top-8';
/**
 * The confetti fall over the day, the missions and the right column's box (the band and the subjects): rows 1–3 in one
 * column, rows 1–2 across both from `xl` (with no mission, the day and the subjects on the left).
 */
/** `STICK`'s top, and as much again under the column. */
const STICK_GAP = 32;

/**
 * Whether the element and `STICK_GAP` above and below fit in the height of the scroller it sits in (the layout's content
 * area): a sticky column taller than that would hide its foot until the page's end. True where nothing can be measured.
 */
function useFitsInScroller(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [fits, setFits] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof ResizeObserver === 'undefined') return;
    let scroller: HTMLElement | null = null;
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const { overflowY } = getComputedStyle(node);
      if (overflowY === 'auto' || overflowY === 'scroll') {
        scroller = node;
        break;
      }
    }
    const measure = () => setFits(el.offsetHeight + 2 * STICK_GAP <= (scroller?.clientHeight ?? window.innerHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (scroller) observer.observe(scroller);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref, enabled]);
  return fits;
}

export function ReviewHome() {
  const navigate = useNavigate();
  const day = useProgress(undefined);
  const percorso = usePercorso();
  const data = day.data;
  const loading = day.status === 'loading';
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [communityRequest, setCommunityRequest] = useState(0);
  // The day block's settings buttons and the road's foot open the settings and take the reader there: the panel takes
  // the focus once drawn.
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
  const goalRef = useRef<HTMLDivElement>(null);
  const { celebratedBefore, markCelebrated } = useCelebratedToday();
  // The day whose burst has run its course on this page.
  const [burstDone, setBurstDone] = useState<string | null>(null);
  // Once a day (progress spec decision 10): here, when the goal's mission is done today with some review (G9) and this
  // browser had not celebrated when the page opened. It follows the data on screen, not the read's status.
  const celebrate = data !== null && goalMissionDone(data) && data.oggi.ripassi > 0 && !celebratedBefore(data.oggi.giorno) && burstDone !== data.oggi.giorno;
  const aside = useRef<HTMLDivElement>(null);
  const fits = useFitsInScroller(aside, !settingsOpen);

  const reload = () => {
    day.reload();
    percorso.reload();
  };

  return (
    // LC23, after Duolingo's home (Luca, 15 November): the road in the middle — the day's one action on top, then «Il tuo
    // percorso», a unit per subject —, and beside it from `lg` the day's numbers: the streak and the level, today's
    // missions. One column on a phone, in the same order. A subject's own «Ripassa» narrows the session, where the
    // subjects' filter did until LC21. The full list of missions closes the left column.
    <section className={cn('relative grid grid-cols-1 gap-8 pb-8', SPLIT)}>
      <div className={cn('grid min-w-0 grid-cols-1 content-start gap-4', LEFT)}>
          <DayBlock
            day={data}
            dayFailed={day.status === 'error'}
            action={data}
            actionFailed={day.status === 'error'}
            stops={percorso.data}
            onRetry={reload}
            onAllSubjects={() => {}}
            onStart={() => navigate('/learn/ripasso/sessione')}
            onOpenSettings={openSettingsFor}
            settingsPanel={STUDY_SETTINGS_PANEL}
            drawGoal={celebrate}
            goalRef={goalRef}
          />
          <TodayCourses />
          <TodayExam />
      </div>
      {/* The day's numbers, beside the road from `lg`, sticky while they fit. */}
      <div ref={aside} className={cn('grid min-w-0 grid-cols-1 content-start gap-6', ASIDE, !settingsOpen && fits && STICK)}>
        <StatsBand
          aside
          data={data}
          loading={loading && data === null}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((open) => !open)}
          onCloseSettings={() => setSettingsOpen(false)}
          onSettingsChanged={reload}
          communityRequest={communityRequest}
          celebrate={celebrate}
        />
        <div className="min-w-0 empty:hidden">
          <TodayMissions
            day={data}
            dayFailed={day.status === 'error'}
            onOpenSettings={openSettingsFor}
            settingsPanel={STUDY_SETTINGS_PANEL}
          />
        </div>
      </div>
      {/* The road and the full list: after the day's numbers on a phone, under the day block from `lg`. */}
      <div className={cn('grid min-w-0 grid-cols-1 content-start gap-8', 'lg:col-start-1 lg:row-start-2')}>
        <LearnPath percorso={percorso} materie={data?.materie ?? null} onRetry={percorso.reload} onOpenCommunity={() => openSettingsFor('comunita')} />
        <div className="min-w-0 empty:hidden">
          <MissionList data={data} loading={loading && data === null} />
        </div>
      </div>
      {/* LC39: no confetti; a curl of smoke leaves the lamp on the day's plate, in the day block, out of the flow. */}
      {celebrate && data && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[32rem]">
          <SmokeRise originRef={goalRef} onStart={() => markCelebrated(data.oggi.giorno)} onDone={() => setBurstDone(data.oggi.giorno)} />
        </div>
      )}
    </section>
  );
}
