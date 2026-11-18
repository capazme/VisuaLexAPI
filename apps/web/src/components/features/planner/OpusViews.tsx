import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, FolderOpen, RotateCcw } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { addDaysToIsoDate, todayInRome } from '../../../utils/dateUtils';
import type { Task, TaskView } from '../../../types/tasks';
import { FOCUS_RING, SECONDARY_BUTTON } from '../studia/progress/tokens';
import { dossierRecency } from '../dossier/dossierUtils';
import { kindLabel } from '../dossier/dossierKinds';
import { QuickAddField } from './QuickAddField';
import { restoreTask } from './taskActions';
import { blockHeading, dayHeading, groupUpcoming, splitToday, UPCOMING_DAYS } from './taskDates';
import type { TaskDraft } from './taskDraft';
import { TaskList } from './TaskList';
import { scrollParentOf } from '../practice/practiceView';
import { TaskSheetScope } from './TaskSheetScope';
import { TaskGroup } from './TaskGroup';
import { WeekStrip } from './WeekStrip';
import { TaskListSkeleton, TaskViewEmpty, TaskViewError, TruncatedNote } from './TaskViewStates';
import { Arrive } from '../../ui/Arrive';
import { useTaskView } from './useTaskView';
import { plannerStore } from './plannerStore';

interface FrameProps {
  view: TaskView;
  heading: string;
  /** The trash's line under its title: what happens to what is there. The planner's views say nothing of themselves (LC83). */
  line?: string;
  defaults?: (today: string) => Partial<TaskDraft>;
  /** Above the rows, under the quick add: the week's strip on «Prossimi giorni». */
  before?: (today: string, tasks: Task[]) => ReactNode;
  children: (tasks: Task[], today: string, optimistic: ReturnType<typeof useTaskView>['optimistic']) => ReactNode;
  /** What an empty view shows; without it the view draws its groups all the same. */
  empty?: ReactNode;
}

/**
 * One view of Opus: the quick add (not in the trash), then the tasks as the view groups them, in one
 * `TaskSheetScope` (the rows' order and the task's sheet). The first read holds the rows' places; a failed read says
 * so with «Riprova» and keeps what was on screen; «today» is the server's day. One way to add, the field, in the flow
 * at every width (LC83, L-73): no button floats over the list, no sheet rises over it.
 */
function ViewFrame({ view, heading, line, defaults, before, children, empty }: FrameProps) {
  const state = useTaskView(view);
  const today = state.answer?.today ?? todayInRome();
  const tasks = state.answer?.tasks ?? [];
  // The inbox has no group to carry its count: its tab does (LC83). The tasks, not their subtasks.
  const count = state.answer ? tasks.filter((task) => !task.parentId).length : null;
  useEffect(() => {
    if (view !== 'inbox') return undefined;
    plannerStore.getState().setInboxCount(count);
    return () => plannerStore.getState().setInboxCount(null);
  }, [view, count]);
  return (
    <section aria-labelledby={`opus-${view}`} className="min-w-0 space-y-5 pb-8">
      {/* Where the focus goes when the last row leaves (`focusAwayFrom`). Said to a screen reader only: the tab names
          the view. */}
      <h2 id={`opus-${view}`} tabIndex={-1} data-focus-fallback className="sr-only">{heading}</h2>
      {line && <p className="text-sm text-slate-600 dark:text-slate-400">{line}</p>}
      {/* Keyed on the day: a page left open overnight proposes the new day, not the one it was opened on. */}
      {defaults && <QuickAddField key={today} view={view} today={today} defaults={defaults(today)} />}
      {before?.(today, tasks)}
      <div aria-busy={state.status === 'loading'} className={cn('space-y-6', state.status === 'loading' && state.answer && 'opacity-60 transition-opacity')}>
        {state.status === 'error' && <TaskViewError onRetry={state.reload} />}
        {/* The rows come in once the first read answers (LC98); a read again keeps them, dimmed. */}
        <Arrive loading={state.answer === null && state.status === 'loading'} placeholder={<TaskListSkeleton />}>
          {state.answer !== null && (
            // Mounted on an empty view too: a sheet open on the last task stays open when the task leaves the view.
            <TaskSheetScope tasks={tasks} today={today} optimistic={state.optimistic} className="space-y-8">
              {tasks.length === 0 && empty ? empty : children(tasks, today, state.optimistic)}
            </TaskSheetScope>
          )}
        </Arrive>
        {state.answer?.truncated && <TruncatedNote />}
      </div>
    </section>
  );
}

/** «Oggi» by dossier: one group per dossier, by title, the inbox last; the order inside each is the server's. */
function byDossier(tasks: Task[], titleOf: (id: string) => string): { dossierId: string | null; title: string; tasks: Task[] }[] {
  const groups = new Map<string | null, Task[]>();
  for (const task of tasks) {
    const list = groups.get(task.dossierId) ?? [];
    list.push(task);
    groups.set(task.dossierId, list);
  }
  return [...groups.entries()]
    .map(([dossierId, list]) => ({ dossierId, title: dossierId ? titleOf(dossierId) : "Lista d'ingresso", tasks: list }))
    .sort((a, b) => (a.dossierId === null ? 1 : b.dossierId === null ? -1 : a.title.localeCompare(b.title, 'it')));
}

const NEXT_ROW = cn(
  'flex min-h-[44px] w-full items-center gap-3 border-t border-slate-200 px-1 text-left text-sm transition-colors hover:bg-slate-100/60 dark:border-slate-800 dark:hover:bg-slate-900/60',
  FOCUS_RING,
);

/**
 * An empty «Scadenziario» (LC83): one line — the field is right above it — then «Riprendi», the dossiers last worked
 * on (the Corpus desk's, by `dossierRecency`: created or last added to, not opened), one row each.
 */
function TodayEmpty() {
  const dossiers = useAppStore((s) => s.dossiers);
  const recent = [...dossiers].sort((a, b) => dossierRecency(b) - dossierRecency(a)).slice(0, 3);
  return (
    <div className="space-y-6">
      <p className="text-slate-700 dark:text-slate-300">Nessun compito per oggi</p>
      {recent.length > 0 && (
        <section aria-labelledby="opus-today-riprendi">
          <h3 id="opus-today-riprendi" className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Riprendi</h3>
          <ul className="border-b border-slate-200 dark:border-slate-800">
            {recent.map((d) => (
              <li key={d.id}>
                <Link to={`/pratiche?dossier=${encodeURIComponent(d.id)}`} className={NEXT_ROW}>
                  <span title={d.title} className="min-w-0 flex-1 truncate text-slate-900 dark:text-slate-50">{d.title}</span>
                  <span className="shrink-0 text-slate-600 dark:text-slate-400">
                    {kindLabel(d.kind)} · {d.items.length === 1 ? '1 voce' : `${d.items.length} voci`}
                  </span>
                  <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-500" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** «Raggruppa» of «Scadenziario», in the page over its rows (L-73, LC91): two buttons, the one in use pressed. */
function GroupingToggle() {
  const grouping = plannerStore((s) => s.grouping);
  return (
    <div role="group" aria-label="Raggruppa" className="flex w-fit gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
      {(['date', 'dossier'] as const).map((choice) => (
        <button
          key={choice}
          type="button"
          aria-pressed={grouping === choice}
          onClick={() => plannerStore.getState().setGrouping(choice)}
          className={cn(
            'min-h-[44px] rounded-md px-4 text-sm font-medium transition-colors',
            FOCUS_RING,
            grouping === choice
              ? 'bg-card text-slate-900 shadow-sm dark:bg-toga-400 dark:text-ink-950'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
          )}
        >
          {choice === 'date' ? 'Per data' : 'Per pratica'}
        </button>
      ))}
    </div>
  );
}

/**
 * «Scadenziario»: by date — the missed deadlines first, then the tasks late on their planned day, then today's, whose
 * rows do not say «Oggi» again — or by dossier, as «Raggruppa» over the rows says (`GroupingToggle`). A new task is
 * for today.
 */
export function TodayView() {
  const grouping = plannerStore((s) => s.grouping);
  const dossiers = useAppStore((s) => s.dossiers);
  const navigate = useNavigate();
  const titleOf = (id: string) => dossiers.find((d) => d.id === id)?.title ?? 'Pratica';
  return (
    <ViewFrame
      view="today"
      heading="Scadenziario"
      defaults={(day) => ({ plannedDate: day })}
      before={(_day, tasks) => tasks.length > 0 && <GroupingToggle />}
      empty={<TodayEmpty />}
    >
      {(tasks, day, optimistic) => {
        if (grouping === 'dossier') {
          return byDossier(tasks, titleOf).map((group) => (
            <TaskGroup
              key={group.dossierId ?? 'inbox'}
              foldKey={`today:dossier:${group.dossierId ?? 'inbox'}`}
              heading={group.title}
              count={group.tasks.length}
              actions={group.dossierId ? [{ label: 'Apri la pratica', icon: FolderOpen, onSelect: () => navigate(`/pratiche?dossier=${encodeURIComponent(group.dossierId!)}`) }] : []}
            >
              <TaskList label={group.title} tasks={group.tasks} today={day} optimistic={optimistic} showDossier={false} subtasksOpen />
            </TaskGroup>
          ));
        }
        const { missedDeadline, late, today: rest } = splitToday(tasks, day);
        return (
          <>
            {missedDeadline.length > 0 && (
              <TaskGroup foldKey="today:missed" heading="Termini scaduti" count={missedDeadline.length}>
                <TaskList label="Termini scaduti" tasks={missedDeadline} today={day} optimistic={optimistic} subtasksOpen />
              </TaskGroup>
            )}
            {late.length > 0 && (
              <TaskGroup foldKey="today:late" heading="In ritardo" count={late.length}>
                <TaskList label="In ritardo" tasks={late} today={day} optimistic={optimistic} subtasksOpen />
              </TaskGroup>
            )}
            {rest.length > 0 && (
              <TaskGroup foldKey="today:today" heading={blockHeading(day, day)} count={rest.length}>
                <TaskList label={dayHeading(day, day)} tasks={rest} today={day} optimistic={optimistic} subtasksOpen dayShown={day} />
              </TaskGroup>
            )}
          </>
        );
      }}
    </ViewFrame>
  );
}

/**
 * «Prossimi giorni» (P2c): the strip of the seven days the server answers (`view=upcoming`: today and the six after
 * it), then one block per day — its heading («Oggi · mar 17», «Domani · mer 18», «Gio 19»), its tasks — even an empty
 * one, so a day chosen in the strip has a place to scroll to; with no task in the seven days, one line instead. A task sits under its planned date when that is in the
 * seven days, else under its deadline (`groupUpcoming`).
 */
export function UpcomingView() {
  const [chosen, setChosen] = useState<string | null>(null);
  const select = (day: string) => {
    setChosen(day);
    // The content scroller alone moves, so the block's heading stops just under the strip where it sticks (its `top`,
    // the phone's bar, and its height). Not `scrollIntoView`: it also scrolls the layout's `overflow: hidden` ancestors
    // when the scroller is at its end, and the whole page, strip and all, slides up with no way back.
    requestAnimationFrame(() => {
      const block = document.getElementById(`opus-day-${day}`);
      const scroller = block && scrollParentOf(block);
      if (!block || !scroller) return;
      const strip = document.querySelector<HTMLElement>('[data-week-strip]');
      const clear = (strip ? (parseFloat(getComputedStyle(strip).top) || 0) + strip.offsetHeight : 0) + 12;
      const top = block.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - clear;
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
      scroller.scrollTo?.({ top: Math.max(0, top), behavior: still ? 'auto' : 'smooth' });
    });
  };
  const daysFrom = (today: string) => Array.from({ length: UPCOMING_DAYS }, (_, i) => addDaysToIsoDate(today, i));
  // A day chosen before midnight, now past, gives way to today.
  const selectedFor = (today: string) => (chosen && daysFrom(today).includes(chosen) ? chosen : today);
  return (
    <ViewFrame
      view="upcoming"
      heading="Prossimi giorni"
      defaults={(day) => ({ plannedDate: day })}
      // Nothing in the seven days: one line, not seven groups at 0 (LC91).
      empty={<p className="text-slate-700 dark:text-slate-300">Nessun compito nei prossimi giorni</p>}
      before={(today, tasks) => (
        <WeekStrip
          today={today}
          days={daysFrom(today)}
          selected={selectedFor(today)}
          counts={new Map(groupUpcoming(tasks, today).map((group) => [group.day, group.tasks.length]))}
          onSelect={select}
        />
      )}
    >
      {(tasks, today, optimistic) => {
        const byDay = new Map(groupUpcoming(tasks, today).map((group) => [group.day, group.tasks]));
        return daysFrom(today).map((day) => {
          const listed = byDay.get(day) ?? [];
          return (
            <TaskGroup key={day} anchorId={`opus-day-${day}`} foldKey={`upcoming:${day}`} heading={blockHeading(day, today)} count={listed.length}>
              {listed.length > 0 && <TaskList label={dayHeading(day, today)} tasks={listed} today={today} optimistic={optimistic} subtasksOpen dayShown={day} />}
            </TaskGroup>
          );
        });
      }}
    </ViewFrame>
  );
}

/** «Lista d'ingresso»: the tasks of no dossier, their subtasks behind each row's counter; its count on its tab. */
export function InboxView() {
  return (
    <ViewFrame
      view="inbox"
      heading="Lista d'ingresso"
      defaults={() => ({})}
      empty={<p className="text-slate-700 dark:text-slate-300">La lista d'ingresso è vuota</p>}
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
      empty={<TaskViewEmpty title="Il cestino dei compiti è vuoto" />}
    >
      {(tasks, _day, optimistic) => (
        <ul aria-label="Compiti nel cestino" className="grid grid-cols-1 gap-1">
          {tasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/40">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] text-slate-900 [overflow-wrap:anywhere] dark:text-slate-50">{task.title}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {task.parentId ? 'Sottocompito · ' : ''}Eliminato{task.deletedAt ? ` il ${deletedOn.format(new Date(task.deletedAt))}` : ''}
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
