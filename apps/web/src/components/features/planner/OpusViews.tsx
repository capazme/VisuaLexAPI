import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { todayInRome } from '../../../utils/dateUtils';
import type { Task, TaskView } from '../../../types/tasks';
import { BLOCK_HEADING, SECONDARY_BUTTON } from '../studia/progress/tokens';
import { QuickAddField } from './QuickAddField';
import { restoreTask } from './taskActions';
import { dayHeading, longDay, splitToday, groupUpcoming } from './taskDates';
import type { TaskDraft } from './taskDraft';
import { TaskList } from './TaskList';
import { moveBetweenRows } from './moveBetweenRows';
import { TaskListSkeleton, TaskViewEmpty, TaskViewError, TruncatedNote } from './TaskViewStates';
import { useTaskView } from './useTaskView';

const GROUP_HEADING = 'font-serif text-lg font-medium text-slate-900 dark:text-slate-50';
const COUNT = 'ml-2 font-sans text-sm font-normal text-slate-600 dark:text-slate-400';

interface FrameProps {
  view: TaskView;
  heading: string;
  /** The line under the heading, from the server's day: the day itself, or what the view holds. */
  line: string | ((today: string) => string);
  defaults?: (today: string) => Partial<TaskDraft>;
  children: (tasks: Task[], today: string, optimistic: ReturnType<typeof useTaskView>['optimistic']) => ReactNode;
  empty: { title: string; line?: string };
}

/**
 * One view of Opus: its heading, the quick add (not in the trash), then the tasks as the view groups them. The first
 * read holds the rows' places; a failed read says so with «Riprova» and keeps what was on screen; «today» is the
 * server's day.
 */
function ViewFrame({ view, heading, line, defaults, children, empty }: FrameProps) {
  const state = useTaskView(view);
  const today = state.answer?.today ?? todayInRome();
  const tasks = state.answer?.tasks ?? [];
  return (
    <section aria-labelledby={`opus-${view}`} className="space-y-5 pb-8">
      <div>
        {/* Where the focus goes when the last row leaves (`focusAwayFrom`). */}
        <h2 id={`opus-${view}`} tabIndex={-1} data-focus-fallback className={cn(BLOCK_HEADING, 'focus-visible:outline-none')}>{heading}</h2>
        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{typeof line === 'function' ? line(today) : line}</p>
      </div>
      {/* Keyed on the day: a page left open overnight proposes the new day, not the one it was opened on. */}
      {defaults && <QuickAddField key={today} view={view} today={today} defaults={defaults(today)} />}
      <div aria-busy={state.status === 'loading'} className={cn('space-y-6', state.status === 'loading' && state.answer && 'opacity-60 transition-opacity')}>
        {state.status === 'error' && <TaskViewError onRetry={state.reload} />}
        {state.answer === null ? (
          state.status === 'loading' && <TaskListSkeleton />
        ) : tasks.length === 0 ? (
          <TaskViewEmpty {...empty} />
        ) : (
          <div data-task-lists onKeyDown={moveBetweenRows} className="space-y-6">
            {children(tasks, today, state.optimistic)}
          </div>
        )}
        {state.answer?.truncated && <TruncatedNote />}
      </div>
    </section>
  );
}

function Group({ id, heading, count, children }: { id: string; heading: string; count: number; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-1">
      <h3 id={id} className={GROUP_HEADING}>
        {heading}
        <span className={COUNT}>
          <span className="sr-only">, </span>
          {count}
          <span className="sr-only">{count === 1 ? ' compito' : ' compiti'}</span>
        </span>
      </h3>
      {children}
    </section>
  );
}

/** «Oggi»: the overdue first, then today's; a new task is for today. */
export function TodayView() {
  return (
    <ViewFrame
      view="today"
      heading="Oggi"
      line={(today) => longDay(today, today)}
      defaults={(day) => ({ plannedDate: day })}
      empty={{ title: 'Nessun compito per oggi', line: 'Quello che aggiungi qui è per oggi.' }}
    >
      {(tasks, day, optimistic) => {
        const { overdue, today: rest } = splitToday(tasks, day);
        return (
          <>
            {overdue.length > 0 && (
              <Group id="opus-today-overdue" heading="Scaduti" count={overdue.length}>
                <TaskList label="Scaduti" tasks={overdue} today={day} optimistic={optimistic} />
              </Group>
            )}
            {rest.length > 0 && (
              <Group id="opus-today-today" heading="Oggi" count={rest.length}>
                <TaskList label="Oggi" tasks={rest} today={day} optimistic={optimistic} />
              </Group>
            )}
          </>
        );
      }}
    </ViewFrame>
  );
}

/** «Prossimi giorni»: today and the six days after it, day by day. */
export function UpcomingView() {
  return (
    <ViewFrame
      view="upcoming"
      heading="Prossimi giorni"
      line="I compiti pianificati o in scadenza nei prossimi 7 giorni."
      defaults={(day) => ({ plannedDate: day })}
      empty={{ title: 'Nessun compito nei prossimi 7 giorni' }}
    >
      {(tasks, day, optimistic) =>
        groupUpcoming(tasks, day).map((group) => (
          <Group key={group.day} id={`opus-upcoming-${group.day}`} heading={dayHeading(group.day, day)} count={group.tasks.length}>
            <TaskList label={dayHeading(group.day, day)} tasks={group.tasks} today={day} optimistic={optimistic} />
          </Group>
        ))
      }
    </ViewFrame>
  );
}

/** «Lista d'ingresso»: the tasks of no dossier. */
export function InboxView() {
  return (
    <ViewFrame
      view="inbox"
      heading="Lista d'ingresso"
      line="I compiti che non appartengono a un dossier."
      defaults={() => ({})}
      empty={{ title: "La lista d'ingresso è vuota", line: 'Un compito senza dossier arriva qui.' }}
    >
      {(tasks, day, optimistic) => <TaskList label="Lista d'ingresso" tasks={tasks} today={day} optimistic={optimistic} />}
    </ViewFrame>
  );
}

const deletedOn = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });

/** The tasks in the trash, latest first, each restored with its subtasks; after 30 days they are gone. */
export function TaskTrashView() {
  return (
    <ViewFrame
      view="trash"
      heading="Cestino dei compiti"
      line="I compiti eliminati restano qui per 30 giorni, poi sono cancellati."
      empty={{ title: 'Il cestino dei compiti è vuoto' }}
    >
      {(tasks, _day, optimistic) => (
        <ul aria-label="Compiti nel cestino" className="grid gap-1">
          {tasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/40">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] text-slate-900 [overflow-wrap:anywhere] dark:text-slate-50">{task.title}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {task.parentId ? 'Sottocompito · ' : ''}Eliminato il {task.deletedAt ? deletedOn.format(new Date(task.deletedAt)) : '—'}
                </p>
              </div>
              <button type="button" onClick={() => void restoreTask(task, optimistic)} className={cn(SECONDARY_BUTTON, 'inline-flex items-center gap-2')}>
                <RotateCcw size={16} aria-hidden />
                Ripristina<span className="sr-only">: {task.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </ViewFrame>
  );
}
