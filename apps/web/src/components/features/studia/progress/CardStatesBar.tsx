import { useState } from 'react';
import { cn } from '../../../../lib/utils';
import type { ConteggiStati } from '../../../../types/studia';
import { formatCount, percent, totalCards } from './layout';
import { CARD_STATES, FOCUS_RING, INK_TEXT, MUTED_TEXT } from './tokens';

export interface CardStatesBarProps {
  stati: ConteggiStati;
}

type StateKey = keyof ConteggiStati;

const cards = (n: number) => `${formatCount(n)} ${n === 1 ? 'scheda' : 'schede'}`;

/**
 * The cards by state (Studia progress spec §4.2; Gymnasium spec §5.3): one stacked bar, new, learning and consolidated
 * (an interval of 21 days or more), and under it each state by name, count and share, so the bar is never read by its
 * colours alone. Each segment is a button: hover, tap or focus says its count and share.
 */
export function CardStatesBar({ stati }: CardStatesBarProps) {
  const [chosen, setChosen] = useState<StateKey | null>(null);
  const total = totalCards(stati);
  const shown = chosen ? CARD_STATES.find((s) => s.key === chosen)! : null;

  return (
    <div className="grid gap-4">
      {total === 0 ? (
        <div className="h-11 rounded-md bg-slate-100 md:h-7 dark:bg-slate-800" />
      ) : (
        <div className="flex h-11 gap-0.5 overflow-hidden rounded-md md:h-7">
          {CARD_STATES.filter((s) => stati[s.key] > 0).map((state) => (
            <button
              key={state.key}
              type="button"
              aria-label={`${state.label}: ${cards(stati[state.key])} (${percent(stati[state.key], total)}%)`}
              onPointerEnter={() => setChosen(state.key)}
              onFocus={() => setChosen(state.key)}
              onClick={() => setChosen(state.key)}
              style={{ flexGrow: stati[state.key] }}
              className={cn('min-w-3 basis-0 motion-safe:transition-[flex-grow] motion-safe:duration-300', state.swatch, FOCUS_RING, 'focus-visible:ring-offset-0', chosen === state.key && 'opacity-80')}
            />
          ))}
        </div>
      )}
      {/* The three states in words and numbers: the bar is their picture. */}
      <dl className="grid grid-cols-3 gap-3">
        {CARD_STATES.map((state) => (
          // The number above its name: `dt` first in the document, drawn second.
          <div key={state.key} className="flex min-w-0 flex-col-reverse justify-end gap-1">
            <dt className={cn('flex items-center gap-1.5 text-sm leading-tight', MUTED_TEXT)}>
              <span aria-hidden className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-sm', state.swatch)} />
              {state.label}
            </dt>
            <dd className="flex flex-wrap items-baseline gap-x-1.5">
              <span className={cn('font-serif text-2xl font-medium leading-none tabular-nums md:text-3xl', INK_TEXT)}>{formatCount(stati[state.key])}</span>
              <span className={cn('text-xs tabular-nums', MUTED_TEXT)}>{percent(stati[state.key], total)}%</span>
            </dd>
          </div>
        ))}
      </dl>
      <p aria-live="polite" className="min-h-5 text-sm tabular-nums text-slate-800 dark:text-slate-100">
        {total === 0
          ? 'Nessuna scheda da studiare, per ora.'
          : shown
            ? `${shown.label}: ${cards(stati[shown.key])} (${percent(stati[shown.key], total)}%)`
            : `${cards(total)} · ${percent(stati.consolidate, total)}% consolidate`}
      </p>
    </div>
  );
}

/** The block's place while its read travels: the bar, the three numbers with their names, the line under them. */
export function CardStatesBarSkeleton() {
  return (
    <div aria-hidden className="grid gap-4">
      <div className="h-11 rounded-md bg-slate-100 motion-safe:animate-pulse md:h-7 dark:bg-slate-800" />
      <div className="h-[4.5rem] rounded-lg bg-slate-100 motion-safe:animate-pulse md:h-[3.75rem] dark:bg-slate-800" />
      <div className="min-h-5" />
    </div>
  );
}
