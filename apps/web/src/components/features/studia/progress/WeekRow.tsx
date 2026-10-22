import { Check } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { Progressi } from '../../../../types/studia';
import { currentWeek, formatDayLong, type WeekDay } from './layout';
import { DAY_STATE_LABEL, INK_BG, INK_BORDER, INK_TEXT, MUTED_TEXT, ON_INK } from './tokens';

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

/**
 * The current week, Monday to Sunday, each box with its letter; the states are also words, for a screen reader. The band's
 * (`aside`: at the right column's width from `xl`).
 */
export function WeekRow({ data, aside }: { data: Progressi; aside: boolean }) {
  // The calendar is sorted by day: its first row is the first day studied in the window, none for a newcomer.
  const week = currentWeek(data.oggi.giorno, data.serie.ultimiGiorni, data.calendario[0]?.giorno);
  return (
    <ol aria-label="Questa settimana" className={cn('grid w-full grid-cols-7 gap-1.5 md:w-auto md:gap-2', aside && 'xl:w-full xl:gap-1.5')}>
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
