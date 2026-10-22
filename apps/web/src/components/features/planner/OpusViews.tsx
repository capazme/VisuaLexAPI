import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, FolderOpen, ListFilter, RotateCcw } from 'lucide-react';
import { MenuButton } from '../../ui/MenuButton';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { addDaysToIsoDate, todayInRome } from '../../../utils/dateUtils';
import type { Task, TaskView } from '../../../types/tasks';
import { QUIET_BUTTON, SECONDARY_BUTTON } from '../studia/progress/tokens';
import { QuickAddField } from './QuickAddField';
import { restoreTask } from './taskActions';
import { blockHeading, dayHeading, groupUpcoming, longDay, splitToday, UPCOMING_DAYS, weekStart } from './taskDates';
import type { TaskDraft } from './taskDraft';
import { TaskList } from './TaskList';
import { scrollParentOf } from '../practice/practiceView';
import { TaskSheetScope } from './TaskSheetScope';
import { InlineAddTask, TaskGroup } from './TaskGroup';
import { StudyTodayRow } from './StudyTodayRow';
import { WeekStrip } from './WeekStrip';
import { TaskListSkeleton, TaskViewEmpty, TaskViewError, TruncatedNote } from './TaskViewStates';
import { useTaskView } from './useTaskView';

const GROUPING_KEY = 'visualex-opus-today-grouping';
type Grouping = 'date' | 'dossier';

/** The grouping «Oggi» was left on, in this browser: a convenience, so a storage that throws reads as the default. */
function storedGrouping(): Grouping {
  try {
    return localStorage.getItem(GROUPING_KEY) === 'dossier' ? 'dossier' : 'date';
  } catch {
    return 'date';
  }
}

interface FrameProps {
  view: TaskView;
  heading: string;
  /** The line under the heading, from the server's day: the day itself, or what the view holds. */
  line: string | ((today: string) => string);
  defaults?: (today: string) => Partial<TaskDraft>;
  /** Beside the heading: the view's options («Raggruppa»). */
  options?: ReactNode;
  /** Above the rows, under the quick add: Gymnasium's day on «Oggi», the week's strip on «Prossimi giorni». */
  before?: ReactNode | ((today: string, tasks: Task[]) => ReactNode);
  children: (tasks: Task[], today: string, optimistic: ReturnType<typeof useTaskView>['optimistic']) => ReactNode;
  /** What an empty view says; without it the view draws its groups all the same (the days of the week). */
  empty?: { title: string; line?: string };
}

/**
 * One view of Opus: its heading, the quick add (not in the trash), then the tasks as the view groups them, in one
 * `TaskSheetScope` (the rows' order and the task's sheet). The first read holds the rows' places; a failed read says
 * so with «Riprova» and keeps what was on screen; «today» is the server's day.
 */
function ViewFrame({ view, heading, line, defaults, options, before, children, empty }: FrameProps) {
  const state = useTaskView(view);
  const today = state.answer?.today ?? todayInRome();
  const tasks = state.answer?.tasks ?? [];
  return (
    <section aria-labelledby={`opus-${view}`} className="min-w-0 space-y-5 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {/* Where the focus goes when the last row leaves (`focusAwayFrom`). Said to a screen reader only: the page's
              title above already names the view (`OpusPage`, L-37). */}
          <h2 id={`opus-${view}`} tabIndex={-1} data-focus-fallback className="sr-only">{heading}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">{typeof line === 'function' ? line(today) : line}</p>
        </div>
        {options}
      </div>
      {/* Keyed on the day: a page left open overnight proposes the new day, not the one it was opened on. */}
      {defaults && <QuickAddField key={today} view={view} today={today} defaults={defaults(today)} />}
      {typeof before === 'function' ? before(today, tasks) : before}
      <div aria-busy={state.status === 'loading'} className={cn('space-y-6', state.status === 'loading' && state.answer && 'opacity-60 transition-opacity')}>
        {state.status === 'error' && <TaskViewError onRetry={state.reload} />}
        {state.answer === null ? (
          state.status === 'loading' && <TaskListSkeleton />
        ) : (
          // Mounted on an empty view too: a sheet open on the last task stays open when the task leaves the view.
          <TaskSheetScope tasks={tasks} today={today} optimistic={state.optimistic} className="space-y-8">
            {tasks.length === 0 && empty ? <TaskViewEmpty {...empty} /> : children(tasks, today, state.optimistic)}
          </TaskSheetScope>
        )}
        {state.answer?.truncated && <TruncatedNote />}
      </div>
    </section>
  );
}

/** «Raggruppa: per data / per dossier», the view's option, in a menu. */
function GroupingMenu({ value, onChange }: { value: Grouping; onChange: (value: Grouping) => void }) {
  const label = value === 'date' ? 'per data' : 'per dossier';
  return (
    <MenuButton
      label={`Raggruppa: ${label}`}
      triggerClassName={cn(QUIET_BUTTON, 'mx-0 inline-flex items-center gap-1.5 px-2 font-normal no-underline hover:no-underline hover:bg-slate-100 dark:hover:bg-slate-800')}
      items={(['date', 'dossier'] as const).map((choice) => ({
        label: choice === 'date' ? 'Per data' : 'Per dossier',
        checked: choice === value,
        onSelect: () => onChange(choice),
      }))}
    >
      <ListFilter size={15} aria-hidden />
      <span>Raggruppa: {label}</span>
    </MenuButton>
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

/**
 * «Oggi»: Gymnasium's day on one line, then by date — the missed deadlines first, then the tasks late on their planned
 * day, then today's — or by dossier; a new task is for today.
 */
export function TodayView() {
  const [grouping, setGrouping] = useState<Grouping>(storedGrouping);
  const dossiers = useAppStore((s) => s.dossiers);
  const navigate = useNavigate();
  const titleOf = (id: string) => dossiers.find((d) => d.id === id)?.title ?? 'Dossier';
  const choose = (value: Grouping) => {
    setGrouping(value);
    try {
      localStorage.setItem(GROUPING_KEY, value);
    } catch {
      // Kept for this visit only.
    }
  };
  return (
    <ViewFrame
      view="today"
      heading="Oggi"
      line={(today) => longDay(today, today)}
      defaults={(day) => ({ plannedDate: day })}
      options={<GroupingMenu value={grouping} onChange={choose} />}
      before={<StudyTodayRow />}
      empty={{ title: 'Nessun compito per oggi', line: 'Quello che aggiungi qui è per oggi.' }}
    >
      {(tasks, day, optimistic) => {
        if (grouping === 'dossier') {
          return byDossier(tasks, titleOf).map((group) => (
            <TaskGroup
              key={group.dossierId ?? 'inbox'}
              foldKey={`today:dossier:${group.dossierId ?? 'inbox'}`}
              heading={group.title}
              count={group.tasks.length}
              add={{ view: 'today', today: day, defaults: { plannedDate: day, ...(group.dossierId ? { dossierId: group.dossierId } : {}) } }}
              actions={group.dossierId ? [{ label: 'Apri il dossier', icon: FolderOpen, onSelect: () => navigate(`/dossier?dossier=${encodeURIComponent(group.dossierId!)}`) }] : []}
            >
              <TaskList label={group.title} tasks={group.tasks} today={day} optimistic={optimistic} showDossier={false} subtasksOpen />
            </TaskGroup>
          ));
        }
        const { missedDeadline, late, today: rest } = splitToday(tasks, day);
        const add = { view: 'today' as const, today: day, defaults: { plannedDate: day } };
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
            {/* Always, with its «+ Aggiungi compito», even when only late tasks are listed. */}
            <TaskGroup foldKey="today:today" heading="Oggi" count={rest.length} add={add}>
              {rest.length > 0 && <TaskList label="Oggi" tasks={rest} today={day} optimistic={optimistic} subtasksOpen />}
            </TaskGroup>
          </>
        );
      }}
    </ViewFrame>
  );
}

/**
 * «Prossimi giorni» (P2c): the week's strip, then one block per day of the chosen week that the view can show — its
 * heading («22 ott · Domani · giovedì»), its tasks, «+ Aggiungi compito» for that day — even an empty one. A task
 * sits under its planned date when that is in the seven days, else under its deadline (`groupUpcoming`). The server
 * answers today and the six days after it (`view=upcoming`), so the weeks are the one or two those days touch.
 */
export function UpcomingView() {
  const [chosen, setChosen] = useState<string | null>(null);
  const select = (day: string) => {
    setChosen(day);
    // After the block is drawn (a day of another week appears with its week), the content scroller alone moves, so
    // the block's heading stops just under the strip where it sticks (its `top`, the phone's bar, and its height).
    // Not `scrollIntoView`: it also scrolls the layout's `overflow: hidden` ancestors when the scroller is at its end,
    // and the whole page, strip and all, slides up with no way back (seen in a headless pass at 390 and 1366 px).
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
  const lastOf = (today: string) => addDaysToIsoDate(today, UPCOMING_DAYS - 1);
  // A day chosen before midnight, now past or out of reach, gives way to today.
  const selectedFor = (today: string) => (chosen && chosen >= today && chosen <= lastOf(today) ? chosen : today);
  return (
    <ViewFrame
      view="upcoming"
      heading="Prossimi giorni"
      line={(today) => `I compiti pianificati o in scadenza da oggi a ${longDay(lastOf(today), today)}.`}
      defaults={(day) => ({ plannedDate: day })}
      before={(today, tasks) => (
        <WeekStrip
          today={today}
          last={lastOf(today)}
          selected={selectedFor(today)}
          counts={new Map(groupUpcoming(tasks, today).map((group) => [group.day, group.tasks.length]))}
          onSelect={select}
        />
      )}
    >
      {(tasks, today, optimistic) => {
        const byDay = new Map(groupUpcoming(tasks, today).map((group) => [group.day, group.tasks]));
        const monday = weekStart(selectedFor(today));
        const days = Array.from({ length: 7 }, (_, i) => addDaysToIsoDate(monday, i)).filter((day) => day >= today && day <= lastOf(today));
        // The server's seven days that run into the next week: said under this one, not left behind the arrow.
        const nextMonday = addDaysToIsoDate(monday, 7);
        const later = [...byDay.entries()].filter(([day]) => day >= nextMonday).reduce((n, [, list]) => n + list.length, 0);
        const blocks = days.map((day) => {
          const listed = byDay.get(day) ?? [];
          return (
            <TaskGroup
              key={day}
              anchorId={`opus-day-${day}`}
              foldKey={`upcoming:${day}`}
              heading={blockHeading(day, today)}
              count={listed.length}
              add={{ view: 'upcoming', today, defaults: { plannedDate: day } }}
            >
              {listed.length > 0 && <TaskList label={dayHeading(day, today)} tasks={listed} today={today} optimistic={optimistic} subtasksOpen dayShown={day} />}
            </TaskGroup>
          );
        });
        return (
          <>
            {blocks}
            {later > 0 && (
              <button type="button" onClick={() => select(nextMonday)} className={cn(QUIET_BUTTON, 'mx-0 inline-flex items-center gap-1.5')}>
                La settimana dopo: {later === 1 ? '1 compito' : `${later} compiti`} fino a {longDay(lastOf(today), today)}
                <ChevronRight size={16} aria-hidden />
              </button>
            )}
          </>
        );
      }}
    </ViewFrame>
  );
}

/** «Lista d'ingresso»: the tasks of no dossier, their subtasks behind each row's counter, and «+ Aggiungi compito». */
export function InboxView() {
  return (
    <ViewFrame
      view="inbox"
      heading="Lista d'ingresso"
      line="I compiti che non appartengono a un dossier."
      defaults={() => ({})}
      empty={{ title: "La lista d'ingresso è vuota", line: 'Un compito senza dossier arriva qui.' }}
    >
      {(tasks, day, optimistic) => (
        <div>
          <TaskList label="Lista d'ingresso" tasks={tasks} today={day} optimistic={optimistic} />
          <InlineAddTask view="inbox" today={day} defaults={{}} />
        </div>
      )}
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
        <ul aria-label="Compiti nel cestino" className="grid grid-cols-1 gap-1">
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
