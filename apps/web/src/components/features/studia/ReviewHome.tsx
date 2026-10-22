import { useEffect, useRef, useState, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import type { Materia } from '../../../types/studia';
import { MATERIA_LABEL } from './studiaLabels';
import { DayBlock } from './missions/DayBlock';
import { MissionList } from './missions/MissionList';
import { TodayMissions } from './missions/TodayMissions';
import { ConfettiBurst } from './progress/Celebration';
import { STUDY_SETTINGS_PANEL, StatsBand } from './progress/StatsBand';
import { SubjectList } from './progress/SubjectList';
import { rememberedMateria, rememberMateria } from './progress/rememberedSubject';
import { useCelebratedToday } from './progress/useCelebratedToday';
import { usePercorso } from './progress/usePercorso';
import { useProgress } from './progress/useProgress';

/**
 * «Oggi», Gymnasium's home (Gymnasium spec §5.1), in the sections' full-width frame, in the order the owner fixed — the
 * day's missions, the numbers, the full list (L-24) — with the day first (G8): the day block (what is on today and
 * «Inizia il ripasso», the page's entry), today's three missions, then the statistics and «Le tue materie» (the subject
 * filter and the road in one list), then «Tutte le missioni». The missions and the statistics are the whole day's
 * (`useProgress(undefined)`); a subject chosen narrows the day block and the session it starts, through a second read
 * made only while one is chosen. The subjects' cards due and their institutes come from a third, `usePercorso` (G5), on
 * which nothing above waits. The server decides what «today» is.
 */
/**
 * From `xl` two columns (G6), seven twelfths and five: the grid, the left column's place, the right column's (the band
 * and the subjects, sticky over every row) and the confetti's box. Applied only out of Focus mode, which narrows the
 * frame to 896 px: there the band would be too narrow for the week. The left holds three rows (the day, the missions,
 * the list); the fourth, `1fr`, takes what the right column has beyond them.
 */
const SPLIT = 'xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:grid-rows-[auto_auto_auto_1fr] xl:pb-0';
const LEFT = 'xl:col-start-1';
const ASIDE = 'xl:col-start-2 xl:row-span-full xl:self-start';
/**
 * Sticky under the heading (G6), so the right column never leaves the page empty under it (G8) — while it fits in the
 * window and the settings are closed: taller, its foot must scroll into reach.
 */
const STICK = 'xl:sticky xl:top-8';
/**
 * The confetti fall over the day, the missions and the right column's box (the band and the subjects): rows 1–3 in one
 * column, rows 1–2 across both from `xl`.
 */
const BURST = 'xl:col-span-full xl:row-end-3';
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
  const split = !useAppStore((s) => s.settings.focusMode);
  const [materia, setMateria] = useState<Materia | undefined>(rememberedMateria);
  const day = useProgress(undefined);
  const narrowed = useProgress(materia, materia !== undefined);
  const percorso = usePercorso();
  const action = materia ? narrowed : day;
  const data = day.data;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [communityRequest, setCommunityRequest] = useState(0);
  // The settings' line under the missions, and the day block's settings buttons, open the settings and take the
  // reader there: the panel takes the focus once drawn.
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
  const aside = useRef<HTMLDivElement>(null);
  const fits = useFitsInScroller(aside, split && !settingsOpen);

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

  return (
    // One column on a phone and a tablet — the day, the missions, the statistics, the subjects, the full list —; from
    // `xl` two (G6): the day, the missions and the list on the left, two thirds, and the statistics with the subjects on
    // the right, kept in sight under the heading while the page scrolls. The document's order is the reading order the
    // owner fixed — missions, statistics, list — on every width; the grid places the right column.
    <section className={cn('relative grid gap-6 pb-8', split && SPLIT)}>
      <div className={cn('min-w-0', split && LEFT)}>
        <DayBlock
          day={data}
          dayFailed={day.status === 'error'}
          action={action.data}
          actionFailed={action.status === 'error'}
          stops={percorso.data}
          onRetry={reload}
          materia={materia}
          subject={materia && MATERIA_LABEL[materia]}
          onAllSubjects={() => choose(undefined)}
          onStart={start}
          onOpenSettings={openSettingsFor}
          settingsPanel={STUDY_SETTINGS_PANEL}
        />
      </div>
      <div className={cn('min-w-0 empty:hidden', split && LEFT)}>
        <TodayMissions
          day={data}
          dayFailed={day.status === 'error'}
          onOpenSettings={openSettingsFor}
          settingsPanel={STUDY_SETTINGS_PANEL}
          celebrate={celebrate}
          stampRef={stampRef}
        />
      </div>
      {/* Under the missions on a phone; beside everything from `xl`, sticky while it fits. */}
      <div ref={aside} className={cn('grid min-w-0 gap-6', split && ASIDE, split && !settingsOpen && fits && STICK)}>
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
        <SubjectList
          materie={data?.materie ?? null}
          loading={loading && data === null}
          reloading={loading && data !== null}
          selected={materia}
          onSelect={choose}
          percorso={percorso}
          onRetryPercorso={percorso.reload}
        />
      </div>
      {/* The confetti start from the stamp, in the goal's row, and fall over the day, the missions and the statistics,
          never further: an absolute box placed on their rows (the grid's area is its containing block), out of the
          flow, so mounting it moves nothing. */}
      {celebrate && data && (
        <div aria-hidden className={cn('pointer-events-none absolute inset-0 col-start-1 row-start-1 row-end-4', split && BURST)}>
          <ConfettiBurst originRef={stampRef} onStart={() => markCelebrated(data.oggi.giorno)} onDone={() => setBurstDone(data.oggi.giorno)} />
        </div>
      )}

      <div className={cn('min-w-0 empty:hidden', split && LEFT)}>
        <MissionList data={data} loading={loading && data === null} />
      </div>
    </section>
  );
}
