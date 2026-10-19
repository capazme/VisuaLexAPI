import { Link } from 'react-router-dom';
import { cn } from '../../../../lib/utils';
import type { Progressi } from '../../../../types/studia';
import { estimateLabel } from '../studiaLabels';
import { GoalStamp } from './Celebration';
import { nextDueDay, todayState } from './today';
import { FOCUS_RING, INK_BG, INK_TEXT, MUTED_TEXT, ON_INK, SUCCESS_TEXT, TILE } from './tokens';

export interface TodayCardProps {
  /** The last answer; null before the first one. */
  data: Progressi | null;
  /** The last read failed (the first, or one after it): the card says so with «Riprova». */
  failed: boolean;
  onRetry: () => void;
  /** The page is narrowed to one subject: today's counts are that subject's, the goal the whole day's. */
  filtered: boolean;
  /** «Inizia» and «Continua»: they stay usable when the progress cannot be read (the session reads its own cards). */
  onStart: () => void;
  /** The stamp is pressed in now (the celebration, once a day; the caller decides). */
  celebrate: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The line under the button: the goal reached, or what is left to keep (or begin) the streak. */
function goalLine(data: Progressi, filtered: boolean): { text: string; met: boolean } {
  const { oggi, serie } = data;
  if (oggi.raggiunto) return { text: `Obiettivo raggiunto. Serie: ${plural(serie.attuale, 'giorno', 'giorni')}.`, met: true };
  const missing = oggi.obiettivo - oggi.ripassi;
  const purpose = serie.attuale === 0 && serie.record === 0 ? 'per il primo giorno della serie' : 'per tenere viva la serie';
  // Narrowed to a subject, today's counts are that subject's: they say nothing of the whole day's queue.
  if (!filtered && oggi.dovute + oggi.nuove < missing) return { text: `Finisci le schede di oggi ${purpose}.`, met: false };
  return { text: `Ancora ${plural(missing, 'ripasso', 'ripassi')} ${purpose}.`, met: false };
}

/** The page's one primary button: 44 px, full width on a phone; a key that presses into its ink edge. */
const PRIMARY = cn(
  'min-h-[44px] w-full rounded-xl px-8 text-base font-semibold md:w-auto',
  'shadow-[0_4px_0_var(--color-primary-950)] transition-[translate,box-shadow] active:translate-y-[3px] active:shadow-[0_1px_0_var(--color-primary-950)] motion-reduce:transition-none',
  'dark:shadow-[0_4px_0_var(--color-primary-500)] dark:active:shadow-[0_1px_0_var(--color-primary-500)]',
  INK_BG,
  ON_INK,
  FOCUS_RING,
);

/**
 * The action of «Oggi» (Gymnasium spec §5.1): what is on today, what it costs, and the page's one primary
 * button. Once the goal is met, the day's stamp and «Continua» while cards are left; with nothing left,
 * «Hai finito per oggi» and the next day with cards. While the first read travels it holds its final size;
 * a failed read says so with «Riprova» and keeps «Inizia».
 */
export function TodayCard({ data, failed, onRetry, filtered, onStart, celebrate }: TodayCardProps) {
  const state = todayState(data, failed, filtered);
  const met = data?.oggi.raggiunto ?? false;
  const cards = data ? data.oggi.dovute + data.oggi.nuove : 0;
  const line = data && state !== 'empty' ? goalLine(data, filtered) : null;
  const next = data && state === 'done' ? nextDueDay(data) : null;

  return (
    <section aria-labelledby="studia-oggi" aria-busy={state === 'loading'} className={cn(TILE, 'relative overflow-hidden p-5 md:p-7')}>
      <h3 id="studia-oggi" className={cn('font-serif text-sm tracking-wide [font-variant:small-caps]', MUTED_TEXT)}>
        Oggi
      </h3>

      {state === 'loading' && (
        // The final size, so nothing jumps when the read answers.
        <div className="mt-2 grid gap-3">
          <p className="sr-only">Carico i tuoi progressi…</p>
          <div aria-hidden className="h-8 w-3/4 rounded-md bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
          <div aria-hidden className="h-4 w-28 rounded bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
          <div aria-hidden className="h-11 w-full rounded-xl bg-slate-100 motion-safe:animate-pulse md:w-40 dark:bg-slate-800" />
          <div aria-hidden className="h-5" />
        </div>
      )}

      {state !== 'loading' && (
        // From `md` the stamp sits in the corner: the text keeps clear of it.
        <div className={cn('mt-2 grid justify-items-stretch gap-3 md:justify-items-start', met && 'md:pr-52')}>
          {state === 'unread' ? (
            <p role="alert" className={cn('font-serif text-2xl leading-snug md:text-3xl', INK_TEXT)}>
              Non riesco a leggere i tuoi progressi.{' '}
              <button type="button" onClick={onRetry} className={cn('min-h-[44px] rounded px-1 font-sans text-base font-medium underline md:min-h-0', FOCUS_RING)}>
                Riprova
              </button>
            </p>
          ) : (
          <p className={cn('font-serif text-2xl leading-snug md:text-3xl', INK_TEXT)} aria-live="polite">
            {state === 'empty' && 'Non hai ancora schede da ripassare.'}
            {state === 'done' && (filtered ? 'Niente da ripassare in questa materia, per oggi.' : 'Hai finito per oggi.')}
            {state === 'todo' && data && `Oggi: ${data.oggi.dovute} da ripassare, ${plural(data.oggi.nuove, 'nuova', 'nuove')}`}
          </p>
          )}
          {state === 'unread' && <p className={cn('-mt-1 text-sm', MUTED_TEXT)}>Puoi ripassare lo stesso: il ripasso legge le sue schede.</p>}

          {state === 'todo' && <p className={cn('-mt-1 text-sm', MUTED_TEXT)}>{estimateLabel(cards)}</p>}
          {state === 'done' && (
            <p className={cn('-mt-1 text-sm', MUTED_TEXT)}>
              {next ? `Le prossime schede: ${next}.` : 'Nessuna scheda in programma nei prossimi 14 giorni.'}
            </p>
          )}
          {state === 'empty' && (
            <p className="max-w-prose text-sm text-slate-700 dark:text-slate-200">
              Per cominciare, apri un articolo dalla <Link to="/" className={cn('font-medium underline', FOCUS_RING)}>Ricerca</Link> e scegli
              «+ Nuova scheda» sotto il testo. Oppure accendi le schede della comunità dall’ingranaggio, in alto.
            </p>
          )}

          {/* A read after the first failed: what is on screen is the last answer. */}
          {failed && state !== 'unread' && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              Non riesco a leggere i tuoi progressi.{' '}
              <button type="button" onClick={onRetry} className={cn('min-h-[44px] rounded px-1 font-medium underline md:min-h-0', FOCUS_RING)}>
                Riprova
              </button>
            </p>
          )}

          {(state === 'todo' || state === 'unread') && (
            <button type="button" onClick={onStart} className={PRIMARY}>
              {met ? 'Continua' : 'Inizia'}
            </button>
          )}

          {line && <p className={cn('min-h-5 text-sm font-medium', line.met ? SUCCESS_TEXT : MUTED_TEXT)}>{line.text}</p>}
        </div>
      )}

      {data && met && (
        <GoalStamp giorno={data.oggi.giorno} serie={data.serie.attuale} press={celebrate} className="mx-auto mt-4 md:absolute md:right-6 md:top-6 md:mt-0" />
      )}
    </section>
  );
}
