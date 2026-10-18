import { useEffect, useState } from 'react';
import { cn } from '../../../../lib/utils';
import type { Materia, Progressi } from '../../../../types/studia';
import { MATERIA_LABEL } from '../studiaLabels';
import { percent, totalCards } from './layout';
import { FOCUS_RING, MUTED_TEXT, subjectHue } from './tokens';

export interface SubjectProgressProps {
  materie: Progressi['materie'];
  selected: Materia | undefined;
  /** Sets the subject; the selected one again clears it. */
  onSelect: (materia: Materia | undefined) => void;
}

/**
 * Progress by subject (Studia progress spec §4.3): always the five subjects, each a button that narrows
 * the dashboard to it; its bar is the share consolidated, in the subject's hue, filling when it appears.
 */
export function SubjectProgress({ materie, selected, onSelect }: SubjectProgressProps) {
  // Drawn empty first, so the bars fill when the panel opens (no movement under reduced motion: the transition is off).
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <ul className="grid gap-1">
      {materie.map((row) => {
        const total = totalCards(row);
        const share = percent(row.consolidate, total);
        const on = selected === row.materia;
        return (
          <li key={row.materia}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(on ? undefined : row.materia)}
              className={cn(
                'grid min-h-[44px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60',
                FOCUS_RING,
                selected !== undefined && !on && 'opacity-50',
                on && 'bg-slate-50 dark:bg-slate-800/60',
              )}
            >
              <span className="min-w-0 text-sm font-medium text-slate-800 dark:text-slate-100">{MATERIA_LABEL[row.materia]}</span>
              <span className={cn('text-xs tabular-nums', MUTED_TEXT)}>
                {total === 0 ? 'Nessuna scheda' : `${row.consolidate} di ${total} consolidate · ${share}%`}
              </span>
              <span aria-hidden className="col-span-2 block h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <span
                  className="block h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
                  style={{ width: filled ? `${share}%` : '0%', backgroundColor: subjectHue(row.materia) }}
                />
              </span>
              {row.ripassi30 > 0 && (
                <span className={cn('col-span-2 text-xs', MUTED_TEXT)}>
                  {row.ripassi30} {row.ripassi30 === 1 ? 'ripasso' : 'ripassi'} negli ultimi 30 giorni
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
