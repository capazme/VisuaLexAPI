import { useRef } from 'react';
import { cn } from '../../../../lib/utils';
import type { Progressi } from '../../../../types/studia';
import { ConfettiBurst, GoalStamp } from './Celebration';
import { GoalRing } from './GoalRing';
import { StreakBadge } from './StreakBadge';
import { FOCUS_RING, INK_BG, INK_TEXT, MUTED_TEXT, ON_INK, SUCCESS_TEXT, TILE } from './tokens';

export interface ProgressBandProps {
  /** The last answer; null before the first one (the band then draws its skeleton). */
  data: Progressi | null;
  /** «Inizia il ripasso» stays usable when the progress cannot be read: the session reads its own cards. */
  onStart: () => void;
  /** Nothing is left today. */
  nothingLeft: boolean;
  /** Plays the celebration now: confetti from the ring, the stamp pressed in (once a day, the caller decides). */
  celebrate?: boolean;
  /** The celebration is over. */
  onCelebrated?: () => void;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The line under «Inizia il ripasso»: the goal reached, or what is left to keep the streak. */
function goalLine(data: Progressi): { text: string; met: boolean } {
  const { oggi, serie } = data;
  if (oggi.raggiunto) return { text: `Obiettivo raggiunto. Serie: ${plural(serie.attuale, 'giorno', 'giorni')}.`, met: true };
  const missing = oggi.obiettivo - oggi.ripassi;
  if (oggi.dovute + oggi.nuove < missing) return { text: 'Finisci le schede di oggi per tenere viva la serie.', met: false };
  return { text: `Ancora ${plural(missing, 'ripasso', 'ripassi')} per tenere viva la serie.`, met: false };
}

/**
 * The top of Studia's home (Studia progress spec §6.2, decision 9): today's goal as a ring, the streak,
 * today's sentence and «Inizia il ripasso» in ink. On a phone the ring and the streak sit side by side
 * above the sentence and a full-width button.
 */
export function ProgressBand({ data, onStart, nothingLeft, celebrate = false, onCelebrated }: ProgressBandProps) {
  const ringRef = useRef<HTMLDivElement>(null);
  const empty = data !== null && data.oggi.dovute === 0 && data.oggi.nuove === 0 && data.stati.nuove + data.stati.apprendimento + data.stati.consolidate === 0;
  const line = data ? goalLine(data) : null;

  return (
    <div className={cn(TILE, 'relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 gap-y-4 overflow-hidden p-4 md:grid-cols-[auto_auto_minmax(0,1fr)] md:gap-x-8 md:p-6')} aria-busy={data === null}>
      {data ? (
        <>
          <div ref={ringRef}>
            <GoalRing ripassi={data.oggi.ripassi} obiettivo={data.oggi.obiettivo} raggiunto={data.oggi.raggiunto} />
          </div>
          <StreakBadge attuale={data.serie.attuale} record={data.serie.record} ultimiGiorni={data.serie.ultimiGiorni} />
        </>
      ) : (
        <>
          <div className="h-32 w-32 rounded-full bg-slate-100 motion-safe:animate-pulse md:h-[148px] md:w-[148px] dark:bg-slate-800" />
          <div className="h-24 w-40 rounded-lg bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800" />
        </>
      )}
      <div className="col-span-2 grid min-w-0 justify-items-stretch gap-3 md:col-span-1 md:justify-items-start">
        <p className={cn('font-serif text-xl leading-snug', INK_TEXT)} aria-live="polite">
          {data === null
            ? 'Carico i tuoi progressi…'
            : empty
              ? 'Non hai ancora schede da ripassare.'
              : nothingLeft
                ? 'Per oggi hai finito. Le prossime schede tornano domani.'
                : `Oggi: ${data.oggi.dovute} da ripassare · ${data.oggi.nuove} nuove`}
        </p>
        <button
          type="button"
          onClick={onStart}
          disabled={nothingLeft}
          className={cn(
            // A key that presses: a darker ink edge under it, which the press takes up.
            'min-h-[44px] rounded-xl px-7 text-base font-semibold shadow-[0_4px_0_var(--color-primary-950)] transition-transform active:translate-y-[3px] active:shadow-[0_1px_0_var(--color-primary-950)] disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none motion-reduce:transition-none dark:shadow-[0_4px_0_var(--color-primary-500)] dark:active:shadow-[0_1px_0_var(--color-primary-500)]',
            INK_BG,
            ON_INK,
            FOCUS_RING,
          )}
        >
          Inizia il ripasso
        </button>
        {data && (
          <p className={cn('text-sm font-medium', line?.met ? SUCCESS_TEXT : MUTED_TEXT)}>
            {empty ? 'Scrivi una scheda da «Le mie schede», o accendi le materie della comunità nelle impostazioni qui sotto.' : line?.text}
          </p>
        )}
      </div>
      {data?.oggi.raggiunto && <GoalStamp giorno={data.oggi.giorno} serie={data.serie.attuale} press={celebrate} className="absolute right-3 top-3" />}
      {celebrate && <ConfettiBurst originRef={ringRef} onDone={onCelebrated} />}
    </div>
  );
}
