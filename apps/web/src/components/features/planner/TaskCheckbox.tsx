import { cn } from '../../../lib/utils';
import { FOCUS_RING } from '../studia/progress/tokens';

/**
 * A task's tick: the native checkbox (Space ticks it) is the whole 44 px square, transparent, and the 20 px box is
 * drawn under it, so the target is 44 px at every width while the box stays small.
 */
export function TaskCheckbox({ label, onTick, focusTarget = false }: { label: string; onTick: () => void; focusTarget?: boolean }) {
  return (
    <span className="relative grid h-11 w-11 shrink-0 place-items-center">
      <input
        type="checkbox"
        {...(focusTarget ? { 'data-task-focus': '' } : {})}
        checked={false}
        onChange={onTick}
        aria-label={label}
        className={cn('peer absolute inset-0 h-11 w-11 cursor-pointer appearance-none rounded-lg bg-transparent', FOCUS_RING)}
      />
      <span
        aria-hidden
        className="pointer-events-none h-5 w-5 rounded-md border-2 border-slate-500 bg-white transition-colors peer-hover:border-primary-700 dark:border-slate-400 dark:bg-slate-900 dark:peer-hover:border-primary-300"
      />
    </span>
  );
}
