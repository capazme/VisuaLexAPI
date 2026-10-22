import { useState, type ReactNode } from 'react';
import { useIsDesktop } from '../../../../hooks/useIsDesktop';
import { cn } from '../../../../lib/utils';
import type { Materia, Progressi } from '../../../../types/studia';
import { MATERIA_LABEL } from '../studiaLabels';
import { CardStatesBar, CardStatesBarSkeleton } from './CardStatesBar';
import { DueForecast, DueForecastSkeleton } from './DueForecast';
import { ReviewTrend, ReviewTrendSkeleton } from './ReviewTrend';
import type { TrendPeriod } from './trend';
import { GoalRing } from './GoalRing';
import { LevelBar } from './LevelBar';
import { rememberedMateria, rememberMateria } from './rememberedSubject';
import { StreakBadge } from './StreakBadge';
import { SubjectChips } from './SubjectChips';
import { SubjectProgress } from './SubjectProgress';
import { BLOCK_HEADING, MUTED_TEXT, SECONDARY_BUTTON, TILE, subjectHue } from './tokens';
import { useProgress } from './useProgress';

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
    <section aria-labelledby={id} aria-busy={busy} className={cn(TILE, 'grid content-start gap-4 p-4 md:p-6')}>
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

/**
 * The streak, today's goal and the level: the pieces of «Oggi», drawn once (Gymnasium spec §5.3; the level since G1c).
 * The reviews of 30 days are the trend's own total (G7, Bill): two counts of one thing, from two tables of the
 * server, read as two answers.
 */
function Summary({ data }: { data: Progressi }) {
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-x-10 gap-y-5">
        <StreakBadge compact attuale={data.serie.attuale} record={data.serie.record} ultimiGiorni={data.serie.ultimiGiorni} />
        <div className="shrink-0">
          <GoalRing compact giorno={data.oggi.giorno} ripassi={data.oggi.ripassi} obiettivo={data.oggi.obiettivo} raggiunto={data.oggi.raggiunto} />
        </div>
      </div>
      {data.livello && <LevelBar livello={data.livello} className="lg:max-w-md" />}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div aria-hidden className="flex flex-wrap items-center gap-x-10 gap-y-5">
      <div className={cn(PULSE, 'h-10 w-40')} />
      <div className={cn(PULSE, 'h-10 w-24')} />
      <div className={cn(PULSE, 'h-[4.5rem] w-full lg:max-w-md')} />
    </div>
  );
}

/**
 * «Progressi», `/studia/progressi` (Gymnasium spec §5.3, G3): everything the home no longer shows, in the sections'
 * full-width frame (G6) — the summary (the streak, today's goal, the level), the subject chips, «Il tuo andamento»
 * across the page (G7: the reviews as a line over 7 days, 30 days or six months, which replaced the calendar), «Le
 * schede per stato» and «I prossimi 14 giorni» side by side from `lg`, and «Per
 * materia» in two columns from `lg`; one column below. The same read as «Oggi» (`useProgress` over `GET
 * /lingo/srs/progressi`): the whole day's for the summary and the subjects, and, while a subject is chosen, that
 * subject's for the trend, the states and the coming days — the summary stays the whole day's (the streak and the
 * goal are), and the subjects list all five. The subject is the one «Oggi» remembers. While the first read travels
 * every block holds its final size; a failed read says so with «Riprova» and keeps what was on screen; a new read of
 * the same subject leaves the last answer on screen, dimmed. The level is the summary's (G1c), the whole day's.
 */
export function ProgressPage() {
  const [materia, setMateria] = useState<Materia | undefined>(rememberedMateria);
  // The trend's period and its opening are the page's: a subject read anew mounts the chart again, on the same period
  // and without playing the opening a second time.
  // On a phone the chart opens on 7 days: thirty points in some 250 px are a saw no one reads (Bill).
  const desktop = useIsDesktop();
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>(() => (desktop ? '30g' : '7g'));
  const [trendOpened, setTrendOpened] = useState(false);
  const day = useProgress(undefined);
  const narrowed = useProgress(materia, materia !== undefined);
  // The trend, the states and the coming days: the subject's read while one is chosen, else the day's.
  const scope = materia ? narrowed : day;
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
        <div className={cn(TILE, 'flex flex-wrap items-center justify-between gap-3 p-4 md:p-5')}>
          <p className="text-sm text-slate-800 dark:text-slate-100">Non riesco a leggere i tuoi progressi.</p>
          <button type="button" onClick={reload} className={SECONDARY_BUTTON}>
            Riprova
          </button>
        </div>
      )}

      {!nothing && (
        <>
          <section aria-label="Riepilogo" aria-busy={dayBusy} className={cn(TILE, 'p-4 md:p-6 transition-opacity', dayBusy && day.data !== null && 'opacity-60')}>
            {day.data ? <Summary data={day.data} /> : <SummarySkeleton />}
          </section>

          <div className="grid gap-2">
            <SubjectChips selected={materia} onSelect={choose} />
            {materia && <p className={cn('max-w-prose text-sm', MUTED_TEXT)}>Andamento, schede per stato e prossimi giorni: solo {MATERIA_LABEL[materia]}.</p>}
          </div>

          <Block id="studia-andamento" title="Il tuo andamento" busy={scopeBusy} stale={scopeBusy && scope.data !== null}>
            {scoped(
              (data) =>
                // A newcomer only: someone back after more than the server's 26 weeks has a record, and a flat line.
                data.calendario.length === 0 && day.data?.serie.record === 0 ? (
                  <p className={cn('max-w-prose text-sm', MUTED_TEXT)}>Il primo giorno comincia oggi: qui si disegnano i ripassi di ogni giorno.</p>
                ) : (
                  <ReviewTrend
                    calendario={data.calendario}
                    today={data.oggi.giorno}
                    obiettivo={data.oggi.obiettivo}
                    hue={hue}
                    narrowed={materia !== undefined}
                    period={trendPeriod}
                    onPeriod={setTrendPeriod}
                    intro={!trendOpened}
                    onIntro={() => setTrendOpened(true)}
                  />
                ),
              <ReviewTrendSkeleton />,
            )}
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
