import { HIDDEN_SCROLLBAR } from '../../../../constants/interactions';
import { cn } from '../../../../lib/utils';
import type { Materia } from '../../../../types/studia';
import { MATERIA_LABEL } from '../studiaLabels';
import { FOCUS_RING, INK_BORDER, subjectHue } from './tokens';

export interface SubjectChipsProps {
  selected: Materia | undefined;
  onSelect: (materia: Materia | undefined) => void;
}

const CHIP = 'inline-flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm md:min-h-0 md:py-1.5';

/**
 * The subject filter of the dashboard and of the session it starts (Studia progress spec §6.2):
 * «Tutte le materie» and the five subjects, one pressed at a time.
 */
export function SubjectChips({ selected, onSelect }: SubjectChipsProps) {
  const chip = (on: boolean) =>
    cn(
      CHIP,
      FOCUS_RING,
      on
        ? cn('border-2 font-semibold text-slate-900 dark:text-white', INK_BORDER)
        : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800',
    );
  return (
    // One scrolling row on a phone, where six chips would take four lines, its bar not drawn; wrapped from `md`.
    <div role="group" aria-label="Materia" className={cn('-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0', HIDDEN_SCROLLBAR)}>
      <button type="button" aria-pressed={selected === undefined} onClick={() => onSelect(undefined)} className={chip(selected === undefined)}>
        Tutte le materie
      </button>
      {(Object.entries(MATERIA_LABEL) as Array<[Materia, string]>).map(([materia, label]) => (
        <button key={materia} type="button" aria-pressed={selected === materia} onClick={() => onSelect(materia)} className={chip(selected === materia)}>
          <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: subjectHue(materia) }} />
          {label}
        </button>
      ))}
    </div>
  );
}
