import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, Folder, Inbox, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { MenuButton } from '../../ui/MenuButton';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { taskService } from '../../../services/taskService';
import type { Task, TaskInput } from '../../../types/tasks';
import { FOCUS_RING, QUIET_BUTTON, SECONDARY_BUTTON } from '../studia/progress/tokens';
import { LinkedText } from './LinkedText';
import { completeWithUndo, type Optimistic } from './taskActions';
import { draftFromTask, draftProblem, MAX_DESCRIPTION, MAX_TITLE } from './taskDraft';
import { failureMessage, plannerStore } from './plannerStore';
import { PRIORITY_LABEL, shortDay } from './taskDates';
import { TaskCheckbox } from './TaskCheckbox';
import { TaskSheetFields, type SheetSave } from './TaskSheetFields';
import { useTaskView } from './useTaskView';
import { FIELD, FIELD_HINT, ICON_BUTTON, META } from './plannerStyles';

export interface TaskSheetProps {
  task: Task;
  today: string;
  optimistic: Optimistic;
  /** The task before and after it in the view it was opened from; null at either end. */
  neighbours: { previous: boolean; next: boolean };
  onStep: (step: -1 | 1) => void;
  /** Opens another task in the sheet: a subtask from its parent, the parent from the path. */
  onOpenTask: (task: Task) => void;
  /** The task's own tick: the sheet hands it back, since its row is the view's. */
  onDone: (task: Task, parent: Task | null) => void;
  onTrash: (task: Task, parent: Task | null) => void;
  onClose: () => void;
  /** Opened from «Aggiungi un sottocompito»: the field to add one takes the focus. */
  focus?: 'subtask';
}

/** The inputs that type letters, where j and k are letters. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || ['TEXTAREA', 'SELECT'].includes(el.tagName)) return true;
  return el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox';
}

/**
 * A task in full, in a window over the list (`ui/Modal`, the whole screen on a phone): its path (dossier, and the
 * parent for a subtask), the arrows to the task before and after it in the view it was opened from (and j, k), «⋯»,
 * the close. On the left the tick, the title and the description, edited where they stand, and the subtasks; on the
 * right the fields (`TaskSheetFields`), under the title on a phone. Every change saves at once and waits for the
 * server; a refusal puts the field back and says why in the server's words. No field for what the server does not
 * keep yet (reminders, an assignee, comments).
 */
export function TaskSheet(props: TaskSheetProps) {
  const { neighbours, onStep, onClose, onOpenTask, onTrash } = props;
  const headingId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  // The task's list (its dossier's, or the inbox): its subtasks, a subtask's parent, and a copy of the task newer
  // than the view's when the sheet has saved it (a subtask opened here is in no view).
  const family = useTaskView(props.task.dossierId ? 'dossier' : 'inbox', props.task.dossierId ?? undefined);
  const listed = family.answer?.tasks ?? [];
  const fresh = listed.find((t) => t.id === props.task.id);
  const task = fresh && fresh.updatedAt > props.task.updatedAt ? fresh : props.task;
  const dossierTitle = useAppStore((s) => (task.dossierId ? s.dossiers.find((d) => d.id === task.dossierId)?.title : undefined));
  const parent = task.parentId ? listed.find((t) => t.id === task.parentId) ?? null : null;
  const [addRequest, setAddRequest] = useState(props.focus === 'subtask' ? 1 : 0);

  const step = (direction: -1 | 1) => {
    if (direction === -1 ? !neighbours.previous : !neighbours.next) return;
    onStep(direction);
    // The body is drawn again for the next task: the focus waits on the sheet, where j and k go on.
    bodyRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || typing(event.target)) return;
    if ((event.target as HTMLElement).closest('[role="menu"], [role="listbox"]')) return;
    if (event.key === 'j' || event.key === 'k') {
      event.preventDefault();
      step(event.key === 'j' ? 1 : -1);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      labelledBy={headingId}
      showCloseButton={false}
      size="xl"
      phoneFullScreen
      className="max-w-[65rem] sm:h-[min(52rem,90vh)]"
      contentClassName="flex min-h-0 flex-col overflow-hidden p-0"
      initialFocusRef={bodyRef}
    >
      <div ref={bodyRef} tabIndex={-1} onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col focus-visible:outline-none">
        <header className="flex shrink-0 items-center gap-1 border-b border-slate-200 py-1 pl-3 pr-1 dark:border-slate-800 md:pl-5">
          <nav aria-label="Dove si trova il compito" className="flex min-w-0 flex-1 items-center gap-1 text-sm text-slate-600 dark:text-slate-400">
            {task.dossierId ? (
              <Link
                to={`/dossier?dossier=${encodeURIComponent(task.dossierId)}`}
                className={cn('inline-flex min-h-[44px] min-w-0 items-center gap-1.5 rounded px-1 hover:text-slate-900 hover:underline dark:hover:text-slate-100', FOCUS_RING)}
              >
                <Folder size={15} aria-hidden className="shrink-0" />
                <span className="truncate">{dossierTitle ?? 'Dossier'}</span>
              </Link>
            ) : (
              <span className="inline-flex min-w-0 items-center gap-1.5 px-1">
                <Inbox size={15} aria-hidden className="shrink-0" />
                <span className="truncate">Lista d&apos;ingresso</span>
              </span>
            )}
            {parent && (
              <>
                <span aria-hidden>/</span>
                <button
                  type="button"
                  onClick={() => onOpenTask(parent)}
                  className={cn('min-h-[44px] min-w-0 truncate rounded px-1 text-left hover:text-slate-900 hover:underline dark:hover:text-slate-100', FOCUS_RING)}
                >
                  <span className="sr-only">Compito principale: </span>
                  {parent.title}
                </button>
              </>
            )}
          </nav>
          <button type="button" aria-label="Compito precedente" aria-keyshortcuts="k" disabled={!neighbours.previous} onClick={() => step(-1)} className={cn(ICON_BUTTON, 'disabled:opacity-40 disabled:hover:bg-transparent')}>
            <ChevronUp size={18} aria-hidden />
          </button>
          <button type="button" aria-label="Compito successivo" aria-keyshortcuts="j" disabled={!neighbours.next} onClick={() => step(1)} className={cn(ICON_BUTTON, 'disabled:opacity-40 disabled:hover:bg-transparent')}>
            <ChevronDown size={18} aria-hidden />
          </button>
          <MenuButton
            label="Altre azioni sul compito"
            triggerClassName={ICON_BUTTON}
            items={[
              ...(task.parentId ? [] : [{ label: 'Aggiungi un sottocompito', icon: Plus, onSelect: () => setAddRequest((n) => n + 1) }]),
              { label: 'Sposta nel cestino', icon: Trash2, danger: true, separatorBefore: !task.parentId, onSelect: () => onTrash(task, parent) },
            ]}
          >
            <MoreHorizontal size={18} aria-hidden />
          </MenuButton>
          <button type="button" aria-label="Chiudi" onClick={onClose} className={ICON_BUTTON}>
            <X size={18} aria-hidden />
          </button>
        </header>
        <SheetBody key={task.id} {...props} task={task} headingId={headingId} listed={listed} familyFailed={family.status === 'error'} familyOptimistic={family.optimistic} parent={parent} addRequest={addRequest} />
      </div>
    </Modal>
  );
}

interface BodyProps extends TaskSheetProps {
  headingId: string;
  listed: Task[];
  familyFailed: boolean;
  familyOptimistic: Optimistic;
  parent: Task | null;
  addRequest: number;
}

/** One task's body, drawn again for each task the arrows open (its edits are its own). */
function SheetBody({ task, today, headingId, listed, familyFailed, familyOptimistic, parent, addRequest, onOpenTask, onDone }: BodyProps) {
  // What the sheet shows: the last answer of its own writes, or what was typed while a write travels, until a newer
  // copy of the task comes from the view.
  const [local, setLocal] = useState<Task | null>(null);
  const shown = local && local.updatedAt >= task.updatedAt ? local : task;
  const [error, setError] = useState<string | null>(null);
  const ticket = useRef(0);
  const subtasks = listed.filter((t) => t.parentId === task.id);

  const save: SheetSave = (patch, input: TaskInput) => {
    const next = { ...shown, ...patch };
    const problem = draftProblem(draftFromTask(next));
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setLocal(next);
    const mine = ++ticket.current;
    taskService.update(task.id, input).then(
      (updated) => {
        if (mine === ticket.current) setLocal(updated);
        plannerStore.getState().changed();
      },
      (failure: { status?: number }) => {
        if (mine !== ticket.current) return;
        setLocal(null);
        setError(failureMessage(failure, 'Non riesco a salvare la modifica. Riprova.'));
        if (failure?.status !== undefined && failure.status >= 400 && failure.status < 500) plannerStore.getState().changed();
      },
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {error && (
        <p role="alert" className="mx-4 mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 md:mx-6 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}
      <div className="grid min-h-full grid-cols-1 md:grid-cols-[minmax(0,1fr)_17.5rem]">
        <div className="min-w-0 px-2 pt-4 md:px-4 md:pt-6">
          <div className="flex items-start gap-1">
            <TaskCheckbox
              label={`Segna come fatto: ${shown.title}${shown.priority < 4 ? `, priorità ${PRIORITY_LABEL[shown.priority].toLowerCase()}` : ''}`}
              priority={shown.priority}
              onTick={() => onDone(shown, parent)}
            />
            <div className="min-w-0 flex-1 pr-2">
              <h2 id={headingId} className="sr-only">{shown.title}</h2>
              <TitleField value={shown.title} onCommit={(title) => save({ title }, { title })} />
              <DescriptionField value={shown.description ?? ''} onCommit={(description) => save({ description: description || null }, { description: description || null })} />
            </div>
          </div>
        </div>

        <aside aria-label="Campi del compito" className="min-w-0 border-y border-slate-200 bg-slate-50 px-4 py-1 md:col-start-2 md:row-span-2 md:row-start-1 md:border-y-0 md:border-l md:px-5 md:py-3 dark:border-slate-800 dark:bg-slate-950/40">
          <TaskSheetFields task={shown} today={today} onSave={save} />
        </aside>

        <div className="min-w-0 px-4 pb-10 pt-4 md:pl-[3.75rem] md:pr-6">
          {task.parentId === null && (
            <Subtasks
              parent={shown}
              subtasks={subtasks}
              today={today}
              failed={familyFailed}
              optimistic={familyOptimistic}
              addRequest={addRequest}
              onOpenTask={onOpenTask}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** The title, edited where it stands: Enter or leaving it saves; Esc puts back what was there. */
function TitleField({ value, onCommit }: { value: string; onCommit: (title: string) => void }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  // As tall as its lines: a long title wraps, never scrolls.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const commit = () => {
    const title = text.replace(/\s+/g, ' ').trim();
    if (!title) {
      setText(value);
      return;
    }
    if (title !== value) onCommit(title);
  };

  return (
    <textarea
      ref={ref}
      aria-label="Titolo"
      rows={1}
      value={text}
      maxLength={MAX_TITLE}
      onChange={(e) => setText(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape' && text !== value) {
          // This Esc undoes the edit; the next one closes the sheet.
          e.preventDefault();
          setText(value);
        }
      }}
      onBlur={commit}
      className={cn(
        'block w-full resize-none overflow-hidden rounded-md bg-transparent px-1 py-1.5 font-serif text-2xl font-medium leading-snug text-slate-900 hover:bg-slate-50 dark:text-slate-50 dark:hover:bg-slate-800/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
      )}
    />
  );
}

/**
 * The description: its addresses as links while it is read; «Modifica la descrizione» (or a click on its text) opens
 * the field, and leaving it saves. Esc gives up the edit; Ctrl or ⌘ with Enter saves.
 */
function DescriptionField({ value, onCommit }: { value: string; onCommit: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const start = () => {
    setText(value);
    setEditing(true);
  };
  const finish = (keep: boolean) => {
    setEditing(false);
    if (keep && text.trim() !== value.trim()) onCommit(text.trim());
  };

  if (editing) {
    return (
      <div className="mt-1 grid gap-1">
        <label htmlFor={`${id}-description`} className="sr-only">Descrizione</label>
        <textarea
          ref={ref}
          id={`${id}-description`}
          value={text}
          rows={4}
          maxLength={MAX_DESCRIPTION}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setText(value);
              setEditing(false);
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              finish(true);
            }
          }}
          aria-describedby={`${id}-hint`}
          className={cn(FIELD, 'py-2')}
        />
        <p id={`${id}-hint`} className={FIELD_HINT}>Gli indirizzi web diventano link. Si salva quando esci dal campo.</p>
      </div>
    );
  }

  if (!value) {
    return (
      <button type="button" onClick={start} className={cn(QUIET_BUTTON, 'mx-0 px-1 font-normal text-slate-600 dark:text-slate-400')}>
        Aggiungi una descrizione
      </button>
    );
  }

  return (
    <div className="group flex items-start gap-1">
      {/* A click on the words opens the field; one on a link follows the link. */}
      <p
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('a')) start();
        }}
        className="min-w-0 flex-1 cursor-text whitespace-pre-line px-1 py-1 text-[15px] leading-relaxed text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300"
      >
        <LinkedText text={value} />
      </p>
      <button type="button" aria-label="Modifica la descrizione" onClick={start} className={ICON_BUTTON}>
        <Pencil size={15} aria-hidden />
      </button>
    </div>
  );
}

interface SubtasksProps {
  parent: Task;
  subtasks: Task[];
  today: string;
  failed: boolean;
  optimistic: Optimistic;
  addRequest: number;
  onOpenTask: (task: Task) => void;
}

/**
 * A task's open subtasks (one level), ticked here as in a list, each opening in the sheet, and «Aggiungi un
 * sottocompito». The server lists open tasks only: how many were done is not known here (no «3/5»).
 */
function Subtasks({ parent, subtasks, today, failed, optimistic, addRequest, onOpenTask }: SubtasksProps) {
  const id = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(addRequest > 0);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState(addRequest);

  // «Aggiungi un sottocompito» from the sheet's «⋯»: open the field (a prop that changed, read during render).
  if (addRequest !== lastRequest) {
    setLastRequest(addRequest);
    setAdding(true);
  }
  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding, addRequest]);

  // The ticked subtask leaves: the focus goes to the next one, else the previous one, else the field to add one.
  const tick = (child: Task) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-subtask-id]') ?? [])];
    const at = items.findIndex((item) => item.dataset.subtaskId === child.id);
    const next = at >= 0 ? (items[at + 1] ?? items[at - 1]) : undefined;
    const target = next?.querySelector<HTMLElement>('input[type="checkbox"]');
    if (target) target.focus();
    else if (inputRef.current) inputRef.current.focus();
    else {
      setAdding(true);
    }
    void completeWithUndo(child, today, optimistic);
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      // A subtask lives in its parent's dossier, and takes its origin.
      await taskService.create({ title: trimmed, parentId: parent.id, origin: parent.origin });
      setTitle('');
      plannerStore.getState().changed();
    } catch (failure) {
      setError(failureMessage(failure, 'Non riesco ad aggiungere il sottocompito. Riprova.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} className="flex items-baseline gap-2 border-b border-slate-200 pb-2 text-sm font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-200">
        Sottocompiti
        {subtasks.length > 0 && (
          <span className="font-normal text-slate-600 dark:text-slate-400">
            <span className="sr-only">: </span>
            {subtasks.length === 1 ? '1 da fare' : `${subtasks.length} da fare`}
          </span>
        )}
      </h3>
      {failed && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Non riesco a leggere i sottocompiti.</p>}
      {subtasks.length > 0 && (
        <ul ref={listRef} className="grid grid-cols-1">
          {subtasks.map((child) => (
            <li key={child.id} data-subtask-id={child.id} className="flex items-start gap-1 border-b border-slate-100 dark:border-slate-800/70">
              <TaskCheckbox
                label={`Segna come fatto: ${child.title}${child.priority < 4 ? `, priorità ${PRIORITY_LABEL[child.priority].toLowerCase()}` : ''}`}
                priority={child.priority}
                onTick={() => tick(child)}
              />
              <div className="min-w-0 flex-1 py-1">
                <button
                  type="button"
                  onClick={() => onOpenTask(child)}
                  className={cn('flex min-h-[44px] w-full items-center rounded text-left text-[15px] text-slate-900 [overflow-wrap:anywhere] hover:underline hover:underline-offset-2 dark:text-slate-100', FOCUS_RING)}
                >
                  {child.title}
                </button>
                {(child.plannedDate || child.dueDate) && (
                  <p className={cn(META, 'pb-1')}>
                    {child.plannedDate && <span>{shortDay(child.plannedDate, today)}{child.plannedTime ? ` · ${child.plannedTime}` : ''}</span>}
                    {child.dueDate && <span>{child.plannedDate ? ' · ' : ''}Termine finale {shortDay(child.dueDate, today).toLowerCase()}</span>}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form
          onSubmit={add}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setAdding(false);
              setTitle('');
              requestAnimationFrame(() => addButtonRef.current?.focus());
            }
          }}
          className="mt-2 flex flex-wrap gap-2"
        >
          <label htmlFor={`${id}-title`} className="sr-only">Nuovo sottocompito</label>
          <input
            ref={inputRef}
            id={`${id}-title`}
            value={title}
            maxLength={MAX_TITLE}
            placeholder="Titolo del sottocompito"
            onChange={(e) => setTitle(e.target.value)}
            className={cn(FIELD, 'min-w-0 flex-1 basis-56')}
            autoComplete="off"
          />
          <button type="submit" disabled={busy || !title.trim()} className={SECONDARY_BUTTON}>
            Aggiungi<span className="sr-only"> il sottocompito</span>
          </button>
        </form>
      ) : (
        <button ref={addButtonRef} type="button" onClick={() => setAdding(true)} className={cn(QUIET_BUTTON, 'mx-0 mt-1 inline-flex items-center gap-2 px-1 font-normal text-slate-700 dark:text-slate-300')}>
          <Plus size={16} aria-hidden className="text-primary-700 dark:text-primary-300" />
          Aggiungi un sottocompito
        </button>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-800 dark:text-red-200">{error}</p>}
    </section>
  );
}
