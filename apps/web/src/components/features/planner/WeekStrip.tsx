import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { MenuButton } from '../../ui/MenuButton';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { addDaysToIsoDate } from '../../../utils/dateUtils';
import { FOCUS_RING } from '../studia/progress/tokens';
import { longDay, monthLabel, stripDay, weekStart } from './taskDates';
import { ICON_BUTTON } from './plannerStyles';

interface Props {
  today: string;
  /** The last day the view can show (the server's window ends there). */
  last: string;
  selected: string;
  /** How many tasks each day in reach holds: a dot under the day, and the count in its name. */
  counts: ReadonlyMap<string, number>;
  /** A day chosen in the strip, the month menu, the arrows or «Oggi»: the view scrolls to its block. */
  onSelect: (day: string) => void;
}

const clamp = (day: string, first: string, last: string) => (day < first ? first : day > last ? last : day);

/**
 * The week of «Prossimi giorni» (P2c): the month (a menu when the days the view can show span two), «‹ Oggi ›» for
 * the week before and after and today, and the strip Monday to Sunday — the chosen day marked, today with a filled
 * ring of its own, a dot under a day with tasks; a day the view cannot show (past, or past the server's seven days) is drawn but cannot be chosen.
 * It stays under the bar at the top while the days scroll.
 */
export function WeekStrip({ today, last, selected, counts, onSelect }: Props) {
  const monday = weekStart(selected);
  const days = Array.from({ length: 7 }, (_, i) => addDaysToIsoDate(monday, i));
  const previous = addDaysToIsoDate(monday, -7);
  const next = addDaysToIsoDate(monday, 7);
  const canPrevious = addDaysToIsoDate(previous, 6) >= today;
  const canNext = next <= last;
  // The months the view can show, each with its first day in reach.
  const months: { label: string; day: string }[] = [];
  for (let day = today; day <= last; day = addDaysToIsoDate(day, 1)) {
    const label = monthLabel(day);
    if (!months.some((m) => m.label === label)) months.push({ label, day });
  }
  const month = monthLabel(selected);

  return (
    <div className={cn('sticky top-[var(--phone-bar-offset,0px)] -mx-1 space-y-2 bg-slate-50 px-1 pb-1 pt-2 transition-[top] duration-200 ease-out motion-reduce:transition-none dark:bg-slate-950', Z_INDEX.sticky)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {months.length > 1 ? (
          <MenuButton
            label={`Mese: ${month}`}
            align="left"
            triggerClassName={cn('min-h-[44px] px-2 text-base font-medium text-slate-900 hover:bg-slate-100 dark:text-slate-50 dark:hover:bg-slate-800')}
            items={months.map((m) => ({ label: m.label, checked: m.label === month, onSelect: () => onSelect(m.day) }))}
          >
            {month}
            <ChevronDown size={16} aria-hidden />
          </MenuButton>
        ) : (
          <p className="px-2 text-base font-medium text-slate-900 dark:text-slate-50">{month}</p>
        )}
        <div role="group" aria-label="Settimana" className="inline-flex items-center rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <button type="button" aria-label="Settimana precedente" disabled={!canPrevious} onClick={() => onSelect(clamp(previous, today, last))} className={cn(ICON_BUTTON, 'disabled:opacity-40 disabled:hover:bg-transparent')}>
            <ChevronLeft size={18} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onSelect(today)}
            className={cn('min-h-[44px] rounded-lg px-3 text-sm font-semibold text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800', FOCUS_RING)}
          >
            Oggi
          </button>
          <button type="button" aria-label="Settimana successiva" disabled={!canNext} onClick={() => onSelect(clamp(next, today, last))} className={cn(ICON_BUTTON, 'disabled:opacity-40 disabled:hover:bg-transparent')}>
            <ChevronRight size={18} aria-hidden />
          </button>
        </div>
      </div>
      <ol aria-label={`Settimana da ${longDay(days[0], today)} a ${longDay(days[6], today)}`} className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800">
        {days.map((day) => {
          const { weekday, date } = stripDay(day);
          const reachable = day >= today && day <= last;
          const chosen = day === selected;
          const isToday = day === today;
          const count = reachable ? counts.get(day) ?? 0 : 0;
          return (
            <li key={day} className="min-w-0">
              <button
                type="button"
                disabled={!reachable}
                aria-pressed={chosen}
                aria-current={isToday ? 'date' : undefined}
                aria-label={`${longDay(day, today)}${isToday ? ', oggi' : ''}${count > 0 ? `, ${count === 1 ? '1 compito' : `${count} compiti`}` : ''}`}
                onClick={() => onSelect(day)}
                className={cn(
                  'relative flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-t-lg text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800 dark:disabled:text-slate-600',
                  chosen && 'font-semibold text-slate-900 dark:text-slate-50',
                  FOCUS_RING,
                )}
              >
                <span className="text-xs">{weekday}</span>
                <span
                  className={cn(
                    'grid h-7 min-w-7 place-items-center rounded-full px-1 text-sm tabular-nums',
                    isToday && 'bg-primary-900 font-semibold text-white dark:bg-primary-300 dark:text-slate-950',
                  )}
                >
                  {date}
                </span>
                <span aria-hidden className={cn('h-1 w-1 rounded-full', count > 0 ? 'bg-slate-500 dark:bg-slate-400' : 'bg-transparent')} />
                {chosen && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary-700 dark:bg-primary-300" />}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
