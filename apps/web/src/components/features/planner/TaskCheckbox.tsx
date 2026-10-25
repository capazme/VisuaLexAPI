import type { TaskPriority } from '../../../types/tasks';
import { cn } from '../../../lib/utils';
import { FOCUS_RING } from '../studia/progress/tokens';
import { PRIORITY_TICK } from './plannerStyles';

/**
 * A task's tick: the native checkbox (Space ticks it) is the whole 44 px square, transparent, and the 20 px ring is
 * drawn under it, so the target is 44 px at every width while the ring stays small. The ring takes the priority's
 * colour and line (`PRIORITY_TICK`); the label says the priority in words.
 */
export function TaskCheckbox({
  label,
  onTick,
  priority = 4,
  focusTarget = false,
}: {
  label: string;
  onTick: () => void;
  priority?: TaskPriority;
  focusTarget?: boolean;
}) {
  return (
    <span className="relative grid h-11 w-11 shrink-0 place-items-center">
      <input
        type="checkbox"
        {...(focusTarget ? { 'data-task-focus': '' } : {})}
        checked={false}
        onChange={onTick}
        aria-label={label}
        className={cn('peer absolute inset-0 h-11 w-11 cursor-pointer appearance-none rounded-full bg-transparent', FOCUS_RING)}
      />
      <span
        aria-hidden
        className={cn(
          'pointer-events-none h-5 w-5 rounded-full transition-colors peer-hover:bg-slate-100 dark:peer-hover:bg-slate-800',
          PRIORITY_TICK[priority],
        )}
      />
    </span>
  );
}
