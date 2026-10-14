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
  /** The first read failed: no skeleton pulsing, no «Carico…», the page's alert says why. */
  failed?: boolean;
  /** The dashboard is narrowed to one subject: today's counts are that subject's, the goal the whole day's. */
  filtered?: boolean;
  /** «Inizia il ripasso» stays usable when the progress cannot be read: the session reads its own cards. */
  onStart: () => void;
  /** Nothing is left today (in the subject chosen, when there is one). */
  nothingLeft: boolean;
  /** Plays the celebration now: confetti from the ring, the stamp pressed in, the streak's count popping (once a day, the caller decides). */
  celebrate?: boolean;
  /** The celebration begins: the caller marks the day at once (decision 10). */
  onCelebrationStart?: () => void;
  /** The celebration is over. */
  onCelebrated?: () => void;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The line under «Inizia il ripasso»: the goal reached, or what is left to keep (or begin) the streak. */
function goalLine(data: Progressi, filtered: boolean): { text: string; met: boolean } {
  const { oggi, serie } = data;
  if (oggi.raggiunto) return { text: `Obiettivo raggiunto. Serie: ${plural(serie.attuale, 'giorno', 'giorni')}.`, met: true };
  const missing = oggi.obiettivo - oggi.ripassi;
  const purpose = serie.attuale === 0 && serie.record === 0 ? 'per il primo giorno della serie' : 'per tenere viva la serie';
  // Narrowed to a subject, today's counts are that subject's: they say nothing of the whole day's queue.
  if (!filtered && oggi.dovute + oggi.nuove < missing) return { text: `Finisci le schede di oggi ${purpose}.`, met: false };
  return { text: `Ancora ${plural(missing, 'ripasso', 'ripassi')} ${purpose}.`, met: false };
}

/** The band's sentence about today. */
function todaySentence(data: Progressi | null, failed: boolean, filtered: boolean, nothingLeft: boolean, empty: boolean): string {
  if (data === null) return failed ? 'I tuoi progressi non sono disponibili, per ora.' : 'Carico i tuoi progressi…';
  if (empty) return 'Non hai ancora schede da ripassare.';
  if (nothingLeft) return filtered ? 'Niente da ripassare in questa materia, per oggi.' : 'Per oggi hai finito. Le prossime schede tornano domani.';
  return `Oggi: ${data.oggi.dovute} da ripassare · ${data.oggi.nuove} nuove`;
}

/**
 * The top of Studia's home (Studia progress spec §6.2, decision 9): today's goal as a ring, the streak,
 * today's sentence and «Inizia il ripasso» in ink. On a phone the ring and the streak sit side by side
 * above the sentence and a full-width button; the stamp sits in the flow under the button there, where it
 * covers nothing, and in the band's corner from `md`.
 */
export function ProgressBand({ data, failed = false, filtered = false, onStart, nothingLeft, celebrate = false, onCelebrationStart, onCelebrated }: ProgressBandProps) {
  const ringRef = useRef<HTMLDivElement>(null);
  const empty = data !== null && data.oggi.dovute === 0 && data.oggi.nuove === 0 && data.stati.nuove + data.stati.apprendimento + data.stati.consolidate === 0;
  const line = data ? goalLine(data, filtered) : null;
  const loading = data === null && !failed;

  return (
    <div className={cn(TILE, 'relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 gap-y-4 overflow-hidden p-4 md:grid-cols-[auto_auto_minmax(0,1fr)] md:gap-x-8 md:p-6')} aria-busy={loading}>
      {data ? (
        <>
          <div ref={ringRef}>
            <GoalRing ripassi={data.oggi.ripassi} obiettivo={data.oggi.obiettivo} raggiunto={data.oggi.raggiunto} />
          </div>
          <StreakBadge attuale={data.serie.attuale} record={data.serie.record} ultimiGiorni={data.serie.ultimiGiorni} pop={celebrate} />
        </>
      ) : (
        <>
          <div className={cn('h-32 w-32 rounded-full bg-slate-100 md:h-[148px] md:w-[148px] dark:bg-slate-800', loading && 'motion-safe:animate-pulse')} />
          <div className={cn('h-24 w-40 rounded-lg bg-slate-100 dark:bg-slate-800', loading && 'motion-safe:animate-pulse')} />
        </>
      )}
      <div className="col-span-2 grid min-w-0 justify-items-stretch gap-3 md:col-span-1 md:justify-items-start">
        <p className={cn('font-serif text-xl leading-snug', INK_TEXT)} aria-live="polite">
          {todaySentence(data, failed, filtered, nothingLeft, empty)}
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
        {data?.oggi.raggiunto && (
          <GoalStamp giorno={data.oggi.giorno} serie={data.serie.attuale} press={celebrate} className="justify-self-center md:absolute md:right-5 md:top-7" />
        )}
        {/* The line keeps its height while the first read travels, so the band does not grow when it answers. */}
        <p className={cn('min-h-5 text-sm font-medium', line?.met ? cn(SUCCESS_TEXT, 'sr-only md:not-sr-only') : MUTED_TEXT)}>
          {data === null ? '' : empty ? 'Scrivi una scheda da «Le mie schede», o accendi le materie della comunità nelle impostazioni qui sotto.' : line?.text}
        </p>
      </div>
      {celebrate && <ConfettiBurst originRef={ringRef} onStart={onCelebrationStart} onDone={onCelebrated} />}
    </div>
  );
}
