import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { ConteggiStati, Progressi } from '../../../../types/studia';
import { GoalRing } from './GoalRing';
import { LevelBar } from './LevelBar';
import { currentWeek, formatDayLong, totalCards, type WeekDay } from './layout';
import { stopStates } from './today';
import { StreakBadge } from './StreakBadge';
import { SettingsGear, StudySettingsPanel } from './StudySettings';
import { BLOCK_HEADING, CARD_STATES, DAY_STATE_LABEL, FOCUS_RING, INK_BG, INK_BORDER, INK_TEXT, MUTED_TEXT, ON_INK, TILE } from './tokens';

export interface StatsBandProps {
  /** The whole day's answer; null before the first one, or when it could not be read. */
  data: Progressi | null;
  /** The first read is travelling: the band holds its places. */
  loading: boolean;
  /** The study settings, open in the card under its heading (G6). */
  settingsOpen: boolean;
  onToggleSettings: () => void;
  onCloseSettings: () => void;
  onSettingsChanged: () => void;
  /** Each new value opens the community's subjects with the settings (a mission asked for them). */
  communityRequest?: number;
  /** The celebration: the streak's count pops. */
  celebrate?: boolean;
  /** «Oggi»'s right column from `xl` (G6): the pieces stack as on a phone. */
  aside?: boolean;
}

/** In the right column from `xl`: the week at the column's width. */
const ASIDE = {
  week: 'xl:ml-0 xl:w-full',
  row: 'xl:w-full xl:gap-1.5',
} as const;

/** A box of the week: ticked for a day that counted, dashed for a rest, empty for a missed one, outlined for today. */
function boxClass(day: WeekDay, today: boolean): string {
  return cn(
    'grid h-8 w-8 place-content-center rounded-md border-[1.5px]',
    day.stato === 'fatto' && cn(INK_BG, INK_BORDER, ON_INK),
    day.stato === 'riposo' && cn('border-dashed', INK_BORDER),
    day.stato === 'saltato' && 'border-slate-300 dark:border-slate-600',
    day.stato === 'oggi' && INK_BORDER,
    (day.stato === 'futuro' || day.stato === 'vuoto') && 'border-dotted border-slate-300 dark:border-slate-700',
    today && 'ring-2 ring-primary-900/40 ring-offset-2 ring-offset-white dark:ring-primary-300/40 dark:ring-offset-slate-900',
  );
}

/** The current week, Monday to Sunday, each box with its letter; the states are also words, for a screen reader. */
export function WeekRow({ data, aside }: { data: Progressi; aside: boolean }) {
  // The calendar is sorted by day: its first row is the first day studied in the window, none for a newcomer.
  const week = currentWeek(data.oggi.giorno, data.serie.ultimiGiorni, data.calendario[0]?.giorno);
  return (
    <ol aria-label="Questa settimana" className={cn('grid w-full grid-cols-7 gap-1.5 md:w-auto md:gap-2', aside && ASIDE.row)}>
      {week.map((day) => {
        const today = day.giorno === data.oggi.giorno;
        return (
          <li key={day.giorno} data-stato={day.stato} className="grid justify-items-center gap-1">
            <span aria-hidden className={cn('text-xs font-medium', today ? INK_TEXT : MUTED_TEXT)}>
              {day.lettera}
            </span>
            <span aria-hidden className={boxClass(day, today)}>
              {day.stato === 'fatto' && <Check size={15} strokeWidth={3} />}
            </span>
            <span className="sr-only">{`${formatDayLong(day.giorno)}: ${DAY_STATE_LABEL[day.stato]}`}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The cards by state in one line (G8): each count with its swatch and its name, «3 nuove · 5 in apprendimento · 2
 * consolidate», and the bar of the three colours under it. The words say it; the bar is their picture.
 */
function StatesLine({ stati }: { stati: ConteggiStati }) {
  const total = totalCards(stati);
  // «3 nuove», «5 in apprendimento», «1 consolidata»: in `CARD_STATES`' order, with their plurals.
  const words = stopStates(stati).split(' · ');
  return (
    <div className="grid gap-2">
      <ul aria-label="Le schede per stato" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums text-slate-700 dark:text-slate-200">
        {CARD_STATES.map((state, index) => (
          <li key={state.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-sm', state.swatch)} />
            {words[index]}
          </li>
        ))}
      </ul>
      <span aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        {total > 0 &&
          CARD_STATES.filter((state) => stati[state.key] > 0).map((state) => (
            <span key={state.key} className={cn('min-w-1 basis-0', state.swatch)} style={{ flexGrow: stati[state.key] }} />
          ))}
      </span>
    </div>
  );
}

/**
 * «I tuoi progressi», one band (Gymnasium spec §5.1). Up to `xl` it spans the page and lays its pieces out in a row from
 * `md`; as «Oggi»'s right column from `xl` (`aside`, G6) it stacks them as on a phone (the week at the column's width):
 * the streak and the gear; the current week as seven boxes; the level (`LevelBar`, G1c: the user's alone); the cards by
 * state in one line with their bar; «Tutti i progressi →», a text link to `/studia/progressi`, where the trend, the
 * coming days and the subjects live (G3: the data in one place). No ring of the goal (G8): the goal's mission says it.
 * The gear opens the study settings in the card, under the heading (G6). While the first read travels it holds its
 * final size; a failed read leaves the heading and the gear (the day block says it failed, with «Riprova»).
 */
/** The panel's id: the gear and the missions' «Cambia…» buttons control it. */
export const STUDY_SETTINGS_PANEL = 'studia-impostazioni';

export function StatsBand({ data, loading, settingsOpen, onToggleSettings, onCloseSettings, onSettingsChanged, communityRequest = 0, celebrate = false, aside = false }: StatsBandProps) {
  const gear = useRef<HTMLButtonElement>(null);
  // Esc inside the panel: closed, and the focus back on the gear that opened it.
  const close = () => {
    onCloseSettings();
    gear.current?.focus();
  };
  return (
    <section aria-labelledby="studia-progressi" aria-busy={loading} className={cn(TILE, 'grid gap-5 p-4 md:p-6')}>
      <div className="flex items-center gap-3">
        <h3 id="studia-progressi" className={BLOCK_HEADING}>
          I tuoi progressi
        </h3>
        <SettingsGear ref={gear} open={settingsOpen} onClick={onToggleSettings} controls={STUDY_SETTINGS_PANEL} />
      </div>
      {/* Under the heading, inside the card, which grows downward; never a window over the page. */}
      <StudySettingsPanel id={STUDY_SETTINGS_PANEL} open={settingsOpen} onClose={close} onChanged={onSettingsChanged} communityRequest={communityRequest} aside={aside} />

      {data ? (
        <>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <StreakBadge compact attuale={data.serie.attuale} record={data.serie.record} ultimiGiorni={data.serie.ultimiGiorni} pop={celebrate} />
            <div className={cn('w-full md:ml-auto md:w-auto', aside && ASIDE.week)}>
              <WeekRow data={data} aside={aside} />
            </div>
          </div>
          {/* A server without the points (#253) sends no level and no missions: no bar, and the goal's ring in the
              missions' stead, so the goal is still said. */}
          {data.livello && <LevelBar livello={data.livello} />}
          {!data.missioni?.length && <GoalRing compact giorno={data.oggi.giorno} ripassi={data.oggi.ripassi} obiettivo={data.oggi.obiettivo} raggiunto={data.oggi.raggiunto} />}
          <StatesLine stati={data.stati} />
          <Link
            to="/studia/progressi"
            className={cn('-mx-1 inline-flex min-h-[44px] items-center gap-1.5 justify-self-start rounded-lg px-1 text-sm font-semibold underline-offset-4 hover:underline', INK_TEXT, FOCUS_RING)}
          >
            Tutti i progressi
            <ArrowRight size={15} aria-hidden />
          </Link>
        </>
      ) : loading ? (
        // The final size, so nothing jumps when the read answers.
        <div aria-hidden className="grid gap-5">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <div className="h-10 w-40 rounded-lg bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
            <div className={cn('h-14 w-full rounded-lg bg-slate-100 motion-safe:animate-pulse md:ml-auto md:w-72 dark:bg-slate-800', aside && ASIDE.week)} />
          </div>
          <div className="h-[4.5rem] rounded-lg bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
          <div className="h-10 rounded-lg bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
          <div className="h-11 w-36 rounded-lg bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
        </div>
      ) : (
        <p className={cn('text-sm', MUTED_TEXT)}>I numeri tornano appena riesco a leggerli.</p>
      )}
    </section>
  );
}
