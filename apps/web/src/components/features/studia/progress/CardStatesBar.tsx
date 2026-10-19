import { useState } from 'react';
import { cn } from '../../../../lib/utils';
import type { ConteggiStati } from '../../../../types/studia';
import { percent, totalCards } from './layout';
import { CARD_STATES, FOCUS_RING, MUTED_TEXT } from './tokens';

export interface CardStatesBarProps {
  stati: ConteggiStati;
}

type StateKey = keyof ConteggiStati;

const cards = (n: number) => `${n} ${n === 1 ? 'scheda' : 'schede'}`;

/**
 * The cards by state (Studia progress spec §4.2): one stacked bar, new, learning and consolidated (an
 * interval of 21 days or more). Each segment is a button: hover, tap or focus says its count and share.
 */
export function CardStatesBar({ stati }: CardStatesBarProps) {
  const [chosen, setChosen] = useState<StateKey | null>(null);
  const total = totalCards(stati);
  const shown = chosen ? CARD_STATES.find((s) => s.key === chosen)! : null;

  return (
    <div className="space-y-3">
      {total === 0 ? (
        <div className="h-7 rounded-md bg-slate-100 dark:bg-slate-800" />
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
              className={cn('min-w-3 basis-0 transition-[flex-grow] duration-500 motion-reduce:transition-none', state.swatch, FOCUS_RING, 'focus-visible:ring-offset-0')}
            />
          ))}
        </div>
      )}
      <ul className={cn('flex flex-wrap gap-x-4 gap-y-1 text-xs', MUTED_TEXT)}>
        {CARD_STATES.map((state) => (
          <li key={state.key} className="flex items-center gap-1.5">
            <span aria-hidden className={cn('inline-block h-2.5 w-2.5 rounded-sm', state.swatch)} />
            {state.label}
          </li>
        ))}
      </ul>
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
