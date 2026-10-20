import { useId, useRef, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { taskService } from '../../../services/taskService';
import type { Task } from '../../../types/tasks';
import { INK_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON } from '../studia/progress/tokens';
import { completeWithUndo, trashWithUndo, type Optimistic } from './taskActions';
import { draftFromTask, draftProblem, emptyDraft, inputFromDraft, MAX_TITLE, type TaskDraft } from './taskDraft';
import { failureMessage, plannerStore } from './plannerStore';
import { TaskFields } from './TaskFields';
import { useTaskView } from './useTaskView';
import { FIELD, FIELD_LABEL } from './plannerStyles';

type Props =
  | { mode: 'edit'; task: Task; today: string; focus?: 'subtask'; optimistic: Optimistic; onClose: () => void }
  | { mode: 'create'; defaults: Partial<TaskDraft>; today: string; onClose: () => void; onCreated?: (task: Task) => void };

/**
 * A task in full: title, description, dates, priority, labels, repetition, dossier; for a task that is not a subtask,
 * its subtasks (one level). Creating («c» from anywhere) takes the same fields. Saving waits for the server; a refusal
 * keeps what was typed and says why, in the server's words.
 */
export function TaskDialog(props: Props) {
  const { onClose, today } = props;
  const editing = props.mode === 'edit' ? props.task : null;
  const [draft, setDraft] = useState<TaskDraft>(() => (editing ? draftFromTask(editing) : emptyDraft(props.mode === 'create' ? props.defaults : {})));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const subtaskRef = useRef<HTMLInputElement>(null);
  const dossiers = useAppStore((s) => s.dossiers);
  const formId = `${useId()}-form`;

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    const problem = draftProblem(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await taskService.update(editing.id, inputFromDraft(draft, { withDossier: editing.parentId === null }));
        plannerStore.getState().changed();
        plannerStore.getState().notify('Compito aggiornato');
        onClose();
      } else {
        const kind = dossiers.find((d) => d.id === draft.dossierId)?.kind;
        const created = await taskService.create(inputFromDraft(draft, { withDossier: true, origin: kind === 'studio' ? 'studio' : 'lavoro' }));
        plannerStore.getState().changed();
        plannerStore.getState().notify('Compito aggiunto');
        if (props.mode === 'create') props.onCreated?.(created);
        onClose();
      }
    } catch (failure) {
      setError(failureMessage(failure, 'Non riesco a salvare il compito. Riprova.'));
      setBusy(false);
    }
  };

  const trash = () => {
    if (props.mode !== 'edit') return;
    onClose();
    // The list's own: the row goes at once, as from its «⋯».
    void trashWithUndo(props.task, props.optimistic);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={editing ? 'Modifica compito' : 'Nuovo compito'}
      size="lg"
      initialFocusRef={props.mode === 'edit' && props.focus === 'subtask' ? subtaskRef : titleRef}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {editing ? (
            <button type="button" onClick={trash} className={cn(QUIET_BUTTON, 'mx-0 inline-flex items-center gap-2 text-red-700 dark:text-red-300')}>
              <Trash2 size={16} aria-hidden /> Sposta nel cestino
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>Annulla</button>
            <button type="submit" form={formId} disabled={busy} className={INK_BUTTON}>
              {busy ? 'Salvo…' : editing ? 'Salva' : 'Aggiungi'}
            </button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={save} noValidate className="grid gap-5">
        {error && (
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
        )}
        <TaskFields draft={draft} onChange={setDraft} withText full dossierLocked={editing !== null && editing.parentId !== null} titleRef={titleRef} />
      </form>
      {editing && editing.parentId === null && <Subtasks parent={editing} today={today} inputRef={subtaskRef} />}
    </Modal>
  );
}

/** A task's open subtasks, ticked here as in a list, and a field to add one: a subtask lives in its parent's dossier. */
function Subtasks({ parent, today, inputRef }: { parent: Task; today: string; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const list = useTaskView(parent.dossierId ? 'dossier' : 'inbox', parent.dossierId ?? undefined);
  const children = (list.answer?.tasks ?? []).filter((task) => task.parentId === parent.id);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

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
    <section aria-labelledby={`${id}-heading`} className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
      <h3 id={`${id}-heading`} className={FIELD_LABEL}>
        Sottocompiti{children.length > 0 ? ` (${children.length})` : ''}
      </h3>
      {list.status === 'error' && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Non riesco a leggere i sottocompiti.</p>}
      {children.length > 0 && (
        <ul className="mt-2 grid gap-1">
          {children.map((child) => (
            <li key={child.id} className="flex items-center gap-1">
              <label className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => void completeWithUndo(child, today, list.optimistic)}
                  aria-label={`Segna come fatto: ${child.title}`}
                  className="h-5 w-5 cursor-pointer appearance-none rounded-md border-2 border-slate-500 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-400 dark:bg-slate-900"
                />
              </label>
              <span className="min-w-0 flex-1 text-sm text-slate-900 [overflow-wrap:anywhere] dark:text-slate-100">{child.title}</span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="mt-2 flex gap-2">
        <label htmlFor={`${id}-title`} className="sr-only">Nuovo sottocompito</label>
        <input
          ref={inputRef}
          id={`${id}-title`}
          value={title}
          maxLength={MAX_TITLE}
          placeholder="Aggiungi un sottocompito"
          onChange={(e) => setTitle(e.target.value)}
          className={cn(FIELD, 'flex-1')}
          autoComplete="off"
        />
        <button type="submit" disabled={busy || !title.trim()} className={SECONDARY_BUTTON}>
          Aggiungi<span className="sr-only"> il sottocompito</span>
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-red-800 dark:text-red-200">{error}</p>}
    </section>
  );
}
