import { useState, type ReactNode } from 'react';
import { useIsDesktop } from '../../../../hooks/useIsDesktop';
import { cn } from '../../../../lib/utils';
import type { Materia, Progressi } from '../../../../types/studia';
import { MATERIA_LABEL } from '../studiaLabels';
import { ActivityCalendar, ActivityCalendarSkeleton } from './ActivityCalendar';
import { CardStatesBar, CardStatesBarSkeleton } from './CardStatesBar';
import { DueForecast, DueForecastSkeleton } from './DueForecast';
import { GoalRing } from './GoalRing';
import { formatCount, recentReviews } from './layout';
import { rememberedMateria, rememberMateria } from './rememberedSubject';
import { StreakBadge } from './StreakBadge';
import { SubjectChips } from './SubjectChips';
import { SubjectProgress } from './SubjectProgress';
import { BLOCK_HEADING, INK_TEXT, MUTED_TEXT, SECONDARY_BUTTON, TILE, subjectHue } from './tokens';
import { useProgress } from './useProgress';

/** The calendar spans six months on a computer and twelve weeks on a phone (Studia progress spec decision 12). */
const DESKTOP_WEEKS = 26;
const PHONE_WEEKS = 12;

const PULSE = 'rounded-lg bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800';
const UNREAD = 'I numeri tornano appena riesco a leggerli.';

interface BlockProps {
  id: string;
  title: string;
  /** A read is travelling: an older answer stays, dimmed, while a new one comes. */
  busy: boolean;
  stale: boolean;
  /** A line under the heading. */
  note?: ReactNode;
  children: ReactNode;
}

/** A block of the page: a tile with its heading in Newsreader (one type language, Gymnasium spec §5.1). */
function Block({ id, title, busy, stale, note, children }: BlockProps) {
  return (
    // `content-start`: beside a taller block (G6) the room left goes under the content, never between its rows.
    <section aria-labelledby={id} aria-busy={busy} className={cn(TILE, 'grid content-start gap-4 p-5 md:p-6')}>
      <div className="grid gap-1">
        <h3 id={id} className={BLOCK_HEADING}>
          {title}
        </h3>
        {note && <p className={cn('max-w-prose text-sm', MUTED_TEXT)}>{note}</p>}
      </div>
      <div className={cn('min-w-0 transition-opacity', stale && 'opacity-60')}>{children}</div>
    </section>
  );
}

/** The streak, today's goal and the reviews of the last 30 days: the pieces of «Oggi», drawn once (Gymnasium spec §5.3). */
function Summary({ data }: { data: Progressi }) {
  return (
    <div className="flex flex-wrap items-center gap-x-10 gap-y-5">
      <StreakBadge compact attuale={data.serie.attuale} record={data.serie.record} ultimiGiorni={data.serie.ultimiGiorni} />
      <div className="shrink-0">
        <GoalRing compact giorno={data.oggi.giorno} ripassi={data.oggi.ripassi} obiettivo={data.oggi.obiettivo} raggiunto={data.oggi.raggiunto} />
      </div>
      <p className="grid gap-1 md:ml-auto">
        <span className={cn('font-serif text-4xl font-medium leading-none tabular-nums', INK_TEXT)}>{formatCount(recentReviews(data.materie))}</span>
        <span className={cn('text-sm', MUTED_TEXT)}>{recentReviews(data.materie) === 1 ? 'ripasso' : 'ripassi'} negli ultimi 30 giorni</span>
      </p>
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div aria-hidden className="flex flex-wrap items-center gap-x-10 gap-y-5">
      <div className={cn(PULSE, 'h-10 w-40')} />
      <div className={cn(PULSE, 'h-10 w-24')} />
      <div className={cn(PULSE, 'h-[3.75rem] w-44 md:ml-auto')} />
    </div>
  );
}

/**
 * «Progressi», `/studia/progressi` (Gymnasium spec §5.3, G3): everything the home no longer shows, in the sections'
 * full-width frame (G6) — the summary (the streak, today's goal, the reviews of 30 days), the subject chips, «Il tuo
 * calendario» across the page (its legend beside it from `lg`), «Le schede per stato» and «I prossimi 14 giorni» side by side from `lg`, and «Per
 * materia» in two columns from `lg`; one column below. The same read as «Oggi» (`useProgress` over `GET
 * /lingo/srs/progressi`): the whole day's for the summary and the subjects, and, while a subject is chosen, that
 * subject's for the calendar, the states and the coming days — the summary stays the whole day's (the streak and the
 * goal are), and the subjects list all five. The subject is the one «Oggi» remembers. While the first read travels
 * every block holds its final size; a failed read says so with «Riprova» and keeps what was on screen; a new read of
 * the same subject leaves the last answer on screen, dimmed. No points and no level (they wait for the server).
 */
export function ProgressPage() {
  const desktop = useIsDesktop();
  const [materia, setMateria] = useState<Materia | undefined>(rememberedMateria);
  const day = useProgress(undefined);
  const narrowed = useProgress(materia, materia !== undefined);
  // The calendar, the states and the coming days: the subject's read while one is chosen, else the day's.
  const scope = materia ? narrowed : day;
  const weeks = desktop ? DESKTOP_WEEKS : PHONE_WEEKS;
  const hue = materia && scope.data ? subjectHue(materia) : undefined;

  const choose = (next: Materia | undefined) => {
    setMateria(next);
    rememberMateria(next);
  };
  const reload = () => {
    day.reload();
    narrowed.reload();
  };

  const dayBusy = day.status === 'loading';
  const scopeBusy = scope.status === 'loading';
  const failed = day.status === 'error' || scope.status === 'error';
  const nothing = day.data === null && day.status === 'error';
  // Before the first answer, or for a subject not answered yet: a place at the final size, or the unread line.
  const scoped = (draw: (data: Progressi) => ReactNode, skeleton: ReactNode) =>
    scope.data ? draw(scope.data) : scopeBusy ? skeleton : <p className={cn('text-sm', MUTED_TEXT)}>{UNREAD}</p>;

  return (
    <section aria-labelledby="studia-progressi-pagina" className="space-y-6 pb-8">
      <h2 id="studia-progressi-pagina" className="font-serif text-2xl font-medium tracking-tight text-slate-900 dark:text-slate-50">
        I tuoi progressi
      </h2>

      {failed && (
        // No alert: the page says it where the numbers would be, and the button reads again.
        <div className={cn(TILE, 'flex flex-wrap items-center justify-between gap-3 p-5')}>
          <p className="text-sm text-slate-800 dark:text-slate-100">Non riesco a leggere i tuoi progressi.</p>
          <button type="button" onClick={reload} className={SECONDARY_BUTTON}>
            Riprova
          </button>
        </div>
      )}

      {!nothing && (
        <>
          <section aria-label="Riepilogo" aria-busy={dayBusy} className={cn(TILE, 'p-5 md:p-6 transition-opacity', dayBusy && day.data !== null && 'opacity-60')}>
            {day.data ? <Summary data={day.data} /> : <SummarySkeleton />}
          </section>

          <div className="grid gap-2">
            <SubjectChips selected={materia} onSelect={choose} />
            {materia && <p className={cn('max-w-prose text-sm', MUTED_TEXT)}>Calendario, schede per stato e prossimi giorni: solo {MATERIA_LABEL[materia]}.</p>}
          </div>

          <Block
            id="studia-calendario"
            title="Il tuo calendario"
            busy={scopeBusy}
            stale={scopeBusy && scope.data !== null}
            // A newcomer only: someone back after more than the calendar's 26 weeks has a record, and an empty calendar.
            note={scope.data && scope.data.calendario.length === 0 && day.data?.serie.record === 0 ? 'Il primo giorno comincia oggi: qui si segnano i giorni in cui ripassi.' : undefined}
          >
            {scoped((data) => <ActivityCalendar calendario={data.calendario} today={data.oggi.giorno} weeks={weeks} hue={hue} narrowed={materia !== undefined} />, <ActivityCalendarSkeleton weeks={weeks} />)}
          </Block>

          {/* Side by side from `lg`, as tall as each other: full width, the forecast's drawing grew to 320 px. */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Block id="studia-stati" title="Le schede per stato" busy={scopeBusy} stale={scopeBusy && scope.data !== null}>
              {scoped((data) => <CardStatesBar stati={data.stati} />, <CardStatesBarSkeleton />)}
            </Block>

            <Block id="studia-prossimi" title="I prossimi 14 giorni" busy={scopeBusy} stale={scopeBusy && scope.data !== null}>
              {scoped((data) => <DueForecast prossimi={data.prossimi} hue={hue} />, <DueForecastSkeleton />)}
            </Block>
          </div>

          <Block id="studia-materie" title="Per materia" busy={dayBusy} stale={dayBusy && day.data !== null}>
            {day.data ? (
              <SubjectProgress materie={day.data.materie} selected={materia} onSelect={choose} />
            ) : (
              <div aria-hidden className="grid gap-2 lg:grid-cols-2">
                {[0, 1, 2, 3, 4].map((n) => (
                  <div key={n} className={cn(PULSE, 'h-28 rounded-xl')} />
                ))}
              </div>
            )}
          </Block>
        </>
      )}
    </section>
  );
}
