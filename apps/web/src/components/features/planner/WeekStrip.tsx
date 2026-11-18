import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { FOCUS_RING } from '../studia/progress/tokens';
import { longDay, stripDay } from './taskDates';

interface Props {
  today: string;
  /** The days the view shows: today and the six after it, the server's window. */
  days: string[];
  selected: string;
  /** How many tasks each day holds: the number beside the day, and in its name. */
  counts: ReadonlyMap<string, number>;
  /** A day chosen in the strip: the view scrolls to its block. */
  onSelect: (day: string) => void;
}

/**
 * The days of «Prossimi giorni» (P2c, LC83): one low row from today, no day gone by — each day «mar 17» on one
 * line, its count of tasks under it where the dot was, today in ink, the chosen day underlined. It stays under the bar
 * at the top while the days scroll; from `md` under the page's header, 3.09375 rem tall: the title's line (`PAGE_TITLE`, 1.875 rem at
 * `leading-tight`), taller than the 36 px tabs (LC110), and 12 px of padding (`OpusPage`).
 */
export function WeekStrip({ today, days, selected, counts, onSelect }: Props) {
  return (
    // `data-week-strip`: the view scrolls a day's block to just under it (`UpcomingView`).
    <div data-week-strip className={cn('sticky top-[var(--phone-bar-offset,0px)] md:top-[calc(var(--phone-bar-offset,0px)+3.09375rem)] -mx-1 bg-slate-50 px-1 transition-[top] duration-(--dur-pop) ease-out motion-reduce:transition-none dark:bg-slate-950', Z_INDEX.sticky)}>
      <ol aria-label={`Giorni da ${longDay(days[0], today)} a ${longDay(days[days.length - 1], today)}`} className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800">
        {days.map((day) => {
          const { weekday, date } = stripDay(day);
          const chosen = day === selected;
          const isToday = day === today;
          const count = counts.get(day) ?? 0;
          return (
            <li key={day} className="min-w-0">
              {/* bare-button: a day of the strip, its weekday over its count and the line under the chosen one. */}
              <button
                type="button"
                aria-pressed={chosen}
                aria-current={isToday ? 'date' : undefined}
                aria-label={`${longDay(day, today)}${isToday ? ', oggi' : ''}${count > 0 ? `, ${count === 1 ? '1 compito' : `${count} compiti`}` : ''}`}
                onClick={() => onSelect(day)}
                className={cn(
                  'relative flex min-h-[44px] w-full flex-col items-center justify-center rounded-t-md px-0.5 text-xs leading-tight text-slate-700 hover:bg-slate-100 sm:text-sm dark:text-slate-300 dark:hover:bg-slate-800',
                  isToday && 'font-semibold text-slate-900 dark:text-slate-50',
                  FOCUS_RING,
                )}
              >
                {/* The day and its number on one line; under it, where the dot was, the count. */}
                <span className="whitespace-nowrap">
                  <span className="max-[359px]:sr-only">{weekday} </span>
                  <span className="tabular-nums">{date}</span>
                </span>
                <span aria-hidden className={cn('text-[11px] font-medium leading-none tabular-nums text-slate-600 dark:text-slate-400', count === 0 && 'invisible')}>{count}</span>
                {chosen && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary-700 dark:bg-primary-300" />}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
