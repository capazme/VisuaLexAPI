import { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CheckCheck, ChevronRight, Folder, Hourglass, ListTree, MoreHorizontal, Pencil, Plus, Repeat, Tag, Trash2 } from 'lucide-react';
import { MenuButton } from '../../ui/MenuButton';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import type { Task } from '../../../types/tasks';
import { FOCUS_RING } from '../studia/progress/tokens';
import { tagLabel } from '../../../utils/tagLabel';
import { LinkedText } from './LinkedText';
import { TaskCheckbox } from './TaskCheckbox';
import { countdown, dayTone, PRIORITY_LABEL, RECURRENCE_LABEL, rowDay, shortDay } from './taskDates';
import { DAY_TONE, DEADLINE_TONE, MENU_TRIGGER, META, PRIORITY_TEXT } from './plannerStyles';

export interface TaskRowActions {
  onTick: (task: Task) => void;
  onOpen: (task: Task, focus?: 'subtask') => void;
  onTrash: (task: Task) => void;
  /** «Completa per sempre»: offered on a repeating task only. */
  onCompleteForever: (task: Task) => void;
}

interface Props extends TaskRowActions {
  task: Task;
  today: string;
  /** Off in the dossier's own panel, where every task is that dossier's. */
  showDossier: boolean;
  /** The day the row's block already names («Prossimi giorni»): its planned day is not repeated, only its time. */
  dayShown?: string;
  /** The subtasks listed under it, and whether they are open (the counter opens and folds them). */
  subtasks?: { count: number; open: boolean; onToggle: () => void };
  children?: React.ReactNode;
}

const time = (value: string | null) => (value ? ` · ${value}` : '');

/**
 * On one line (a wide list, 1024 px) the labels and the dossier shrink with the room the other signs leave, down to
 * «U…» and «R». One that would be cut under two letters' width is not drawn (LC91): all shown, measured, the cut ones
 * hidden, in one frame, at each render of the row (any sign may take room) and when its width changes.
 */
function useHideWhenCut(signs: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const box = signs.current;
    if (!box) return undefined;
    const check = () => {
      const parts = [...box.querySelectorAll<HTMLElement>('[data-squeezable]')];
      parts.forEach((part) => { part.style.display = ''; });
      for (const part of parts) {
        const text = part.querySelector<HTMLElement>('.truncate');
        const em = parseFloat(getComputedStyle(part).fontSize) || 12;
        if (text && text.scrollWidth > text.clientWidth && text.clientWidth < 2 * em) part.style.display = 'none';
      }
    };
    check();
    const row = box.closest('li');
    const observer = typeof ResizeObserver === 'function' && row ? new ResizeObserver(check) : null;
    if (observer && row) observer.observe(row);
    return () => observer?.disconnect();
  });
}

/**
 * One task, on two levels as the list's rows are (P2b): the tick (a real checkbox, so Space ticks it; its ring the
 * priority's), the title (opens the task's sheet), its description in one grey line, then a line of signs — the
 * planned day in its colour and in words (`rowDay`: «Domani», «ven 23», «Ieri · in ritardo di 1 giorno»), the
 * deadline bordered with its count, the subtasks' counter (which opens them in place), the repetition, the priority in
 * words, the labels — with the dossier at its right end, in grey; and «⋯». The list moves between rows with the arrows
 * (`TaskList`).
 */
export function TaskRow({ task, today, showDossier, dayShown, subtasks, onTick, onOpen, onTrash, onCompleteForever, children }: Props) {
  const dossierTitle = useAppStore((s) => (task.dossierId ? s.dossiers.find((d) => d.id === task.dossierId)?.title : undefined));
  const due = task.dueDate ? countdown(task.dueDate, today) : null;
  const plannedShown = task.plannedDate !== null && !(task.plannedDate === dayShown && !task.plannedTime);
  const signs = useRef<HTMLDivElement>(null);
  useHideWhenCut(signs);
  const hasSigns = Boolean(plannedShown || due || (subtasks && subtasks.count > 0) || task.recurrence || task.priority < 4 || task.labels.length > 0 || (showDossier && task.dossierId));

  return (
    <li data-task-row data-task-id={task.id} className="relative min-w-0">
      <div className="group relative flex items-start gap-1 border-b border-slate-200 py-0.5 pr-0.5 transition-colors @2xl:items-center @2xl:py-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/30">
        <TaskCheckbox
          label={`Segna come fatto: ${task.title}${task.priority < 4 ? `, priorità ${PRIORITY_LABEL[task.priority].toLowerCase()}` : ''}`}
          priority={task.priority}
          onTick={() => onTick(task)}
          focusTarget
        />

        {/* A wide list (from 42 rem, the row's own width, so a dossier's narrow panel keeps two lines): one line, the
            title at the left and the signs at the right before «⋯», 44–48 px tall (LC83). */}
        <div className={cn('min-w-0 flex-1 @2xl:flex @2xl:items-center @2xl:gap-4 @2xl:pb-0', hasSigns ? 'pb-2' : 'pb-0.5')}>
          <div className="min-w-0 @2xl:flex-1">
          {/* bare-button: the task's title, which opens it: words on the row, not a button's look. */}
          <button
            type="button"
            data-task-title
            onClick={() => onOpen(task)}
            className={cn('flex min-h-[44px] w-full items-center rounded py-2.5 text-left text-[15px] leading-snug text-slate-900 [overflow-wrap:anywhere] hover:underline hover:underline-offset-2 dark:text-slate-50', FOCUS_RING)}
          >
            {task.title}
          </button>
          {task.description && (
            <p className="-mt-2 mb-0.5 line-clamp-1 text-[13px] text-slate-600 [overflow-wrap:anywhere] dark:text-slate-400">
              <LinkedText text={task.description} />
            </p>
          )}
          </div>
          {hasSigns && (
            <div ref={signs} className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 @2xl:mt-0 @2xl:max-w-[60%] @2xl:flex-nowrap @2xl:justify-end">
              {task.plannedDate && plannedShown && (
                <span className={cn(META, DAY_TONE[dayTone(task.plannedDate, today)])}>
                  <CalendarDays size={12} aria-hidden />
                  {task.plannedDate === dayShown ? (
                    <>
                      <span className="sr-only">Ora pianificata: </span>
                      {task.plannedTime}
                    </>
                  ) : (
                    <>
                      <span className="sr-only">Data pianificata: </span>
                      {rowDay(task.plannedDate, today)}
                      {time(task.plannedTime)}
                    </>
                  )}
                </span>
              )}
              {due && task.dueDate && (
                // On a phone the deadline is a short word in its colour, no box (LC33, after Todoist's red date).
                <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold @2xl:shrink-0 @2xl:whitespace-nowrap max-md:border-transparent! max-md:bg-transparent! max-md:px-0 max-md:py-0', DEADLINE_TONE[due.tone])}>
                  <Hourglass size={12} aria-hidden />
                  <span className="max-md:sr-only">
                    {due.tone === 'today'
                      ? `Termine finale: scade oggi${time(task.dueTime)}`
                      : `Termine finale ${shortDay(task.dueDate, today).toLowerCase()}${time(task.dueTime)} · ${due.text}`}
                  </span>
                  <span aria-hidden className="md:hidden">
                    {due.tone === 'today' ? `Scade oggi${time(task.dueTime)}` : `Termine ${shortDay(task.dueDate, today).toLowerCase()}${time(task.dueTime)}`}
                  </span>
                </span>
              )}
              {subtasks && subtasks.count > 0 && (
                // bare-button: a sign of the row's line, drawn as the others (`META`), that opens the subtasks.
                <button
                  type="button"
                  aria-expanded={subtasks.open}
                  onClick={subtasks.onToggle}
                  // 44 px tall for a finger, its extra height laid over the gaps (the line stays its height) where a
                  // pointer is precise; on a phone the line takes the height, so no target overlaps the title's.
                  className={cn(META, '-my-3.5 min-h-[44px] rounded px-1 max-md:my-0 hover:text-slate-900 dark:hover:text-slate-100', FOCUS_RING)}
                >
                  <ChevronRight size={12} aria-hidden className={cn('transition-transform motion-reduce:transition-none', subtasks.open && 'rotate-90')} />
                  <ListTree size={12} aria-hidden />
                  {subtasks.count}
                  <span className="sr-only">{subtasks.count === 1 ? ' sottocompito' : ' sottocompiti'}</span>
                </button>
              )}
              {task.recurrence && (
                <span className={META}>
                  <Repeat size={12} aria-hidden />
                  {RECURRENCE_LABEL[task.recurrence]}
                </span>
              )}
              {task.priority < 4 && (
                <span className={cn('text-xs font-semibold', PRIORITY_TEXT[task.priority])}>
                  {task.priority === 1 ? 'Urgente' : `Priorità ${PRIORITY_LABEL[task.priority].toLowerCase()}`}
                </span>
              )}
              {task.labels.map((label) => (
                <span key={label} data-squeezable className={cn(META, 'max-w-full rounded bg-slate-100 px-1.5 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300')}>
                  <Tag size={11} aria-hidden />
                  <span className="sr-only">Etichetta: </span>
                  {/* Shown as the dossiers' tags are, its first letter capitalised; stored as typed. */}
                  <span className="truncate">{tagLabel(label)}</span>
                </span>
              ))}
              {showDossier && task.dossierId && (
                <Link
                  data-squeezable
                  to={`/pratiche?dossier=${encodeURIComponent(task.dossierId)}`}
                  // At the line's right end; 44 px tall for a finger, laid over the gaps where a pointer is precise.
                  className={cn(META, '-my-3.5 max-md:my-0 ml-auto min-h-[44px] max-w-full rounded hover:text-slate-900 hover:underline dark:hover:text-slate-100 sm:max-w-[45%] @2xl:ml-0 @2xl:min-w-0 @2xl:max-w-[14rem] @2xl:shrink', FOCUS_RING)}
                >
                  <span className="sr-only">Pratica: </span>
                  <span className="truncate">{dossierTitle ?? 'Pratica'}</span>
                  <Folder size={12} aria-hidden className="shrink-0" />
                </Link>
              )}
            </div>
          )}
        </div>

        <MenuButton
          label={`Azioni: ${task.title}`}
          triggerClassName={MENU_TRIGGER}
          items={[
            { label: 'Modifica', icon: Pencil, onSelect: () => onOpen(task) },
            // One level: a subtask takes none, whether it is drawn under its parent or as a row of its own.
            ...(task.parentId ? [] : [{ label: 'Aggiungi un sottocompito', icon: Plus, onSelect: () => onOpen(task, 'subtask') }]),
            ...(task.recurrence ? [{ label: 'Completa per sempre', icon: CheckCheck, onSelect: () => onCompleteForever(task) }] : []),
            { label: 'Sposta nel cestino', icon: Trash2, danger: true, separatorBefore: true, onSelect: () => onTrash(task) },
          ]}
        >
          <MoreHorizontal size={18} aria-hidden />
        </MenuButton>
      </div>
      {children}
    </li>
  );
}
