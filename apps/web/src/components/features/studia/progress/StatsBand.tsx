import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { ConteggiStati, Progressi } from '../../../../types/studia';
import { GoalRing } from './GoalRing';
import { LevelBar } from './LevelBar';
import { currentWeek, formatDayLong, totalCards, type WeekDay } from './layout';
import { StreakBadge } from './StreakBadge';
import { SettingsGear, StudySettingsPanel } from './StudySettings';
import { BLOCK_HEADING, CARD_STATES, DAY_STATE_LABEL, INK_BG, INK_BORDER, INK_TEXT, MUTED_TEXT, ON_INK, SECONDARY_BUTTON, TILE } from './tokens';

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

/**
 * In the right column from `xl`: the week and the link at the column's width, the numbers a step smaller, and the three
 * states in columns as wide as their words, spread across, so «In apprendimento» stays on one line under its number.
 */
const ASIDE = {
  week: 'xl:ml-0 xl:w-full',
  row: 'xl:w-full xl:gap-1.5',
  numbers: 'xl:grid-cols-[repeat(3,auto)] xl:justify-between',
  label: 'xl:whitespace-nowrap',
  number: 'xl:text-3xl',
  link: 'xl:w-full',
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
function WeekRow({ data, aside }: { data: Progressi; aside: boolean }) {
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

/** The cards by state: three large numbers in the reader's serif, their names in the interface's sans, the bar under. */
function StateNumbers({ stati, aside }: { stati: ConteggiStati; aside: boolean }) {
  const total = totalCards(stati);
  return (
    <div className="grid gap-3">
      <dl className={cn('grid grid-cols-3 gap-3', aside && ASIDE.numbers)}>
        {CARD_STATES.map((state) => (
          // The number above its name: `dt` first in the document, drawn second; packed to the top, so the three
          // numbers stay on one line when a name takes two.
          <div key={state.key} className="flex flex-col-reverse justify-end gap-1">
            <dt className={cn('flex items-center gap-1.5 text-sm leading-tight', aside && ASIDE.label, MUTED_TEXT)}>
              <span aria-hidden className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-sm', state.swatch)} />
              {state.label}
            </dt>
            <dd className={cn('font-serif text-3xl font-medium leading-none tabular-nums md:text-4xl', aside && ASIDE.number, INK_TEXT)}>{stati[state.key]}</dd>
          </div>
        ))}
      </dl>
      {/* The numbers say it: the bar is their picture. */}
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
 * `md`; as «Oggi»'s right column from `xl` (`aside`, G6), about 300 to 400 px, it stacks them as on a phone (the week
 * and «Tutti i progressi» at the column's width): the streak, today's goal and the gear; the current week as
 * seven boxes; the level (`LevelBar`, G1c: the user's alone); the cards by state as three numbers with their bar; «Tutti i progressi», a link to `/studia/progressi`,
 * where the long calendar, the coming days and the subjects live (G3: the data in one place). The gear opens the study
 * settings in the card, under the heading (G6). While the first read travels it holds its final size; a failed read leaves the
 * heading and the gear (the missions say it failed, with «Riprova»).
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
            <div className="shrink-0">
              <GoalRing compact giorno={data.oggi.giorno} ripassi={data.oggi.ripassi} obiettivo={data.oggi.obiettivo} raggiunto={data.oggi.raggiunto} />
            </div>
            <div className={cn('w-full md:ml-auto md:w-auto', aside && ASIDE.week)}>
              <WeekRow data={data} aside={aside} />
            </div>
          </div>
          <LevelBar livello={data.livello} />
          <StateNumbers stati={data.stati} aside={aside} />
          <Link to="/studia/progressi" className={cn(SECONDARY_BUTTON, 'inline-flex w-full items-center justify-center md:w-auto md:justify-self-start', aside && ASIDE.link)}>
            Tutti i progressi
          </Link>
        </>
      ) : loading ? (
        // The final size, so nothing jumps when the read answers.
        <div aria-hidden className="grid gap-5">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <div className="h-10 w-40 rounded-lg bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
            <div className="h-10 w-24 rounded-lg bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
            <div className={cn('h-14 w-full rounded-lg bg-slate-100 motion-safe:animate-pulse md:ml-auto md:w-72 dark:bg-slate-800', aside && ASIDE.week)} />
          </div>
          <div className="h-[4.5rem] rounded-lg bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
          <div className="h-[4.5rem] rounded-lg bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
          <div className={cn('h-11 w-full rounded-xl bg-slate-100 motion-safe:animate-pulse md:w-36 dark:bg-slate-800', aside && ASIDE.link)} />
        </div>
      ) : (
        <p className={cn('text-sm', MUTED_TEXT)}>I numeri tornano appena riesco a leggerli.</p>
      )}
    </section>
  );
}
