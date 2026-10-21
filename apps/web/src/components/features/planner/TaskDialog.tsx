import { useId, useRef, useState, type FormEvent } from 'react';
import { Modal } from '../../ui/Modal';
import { useAppStore } from '../../../store/useAppStore';
import { taskService } from '../../../services/taskService';
import type { Task } from '../../../types/tasks';
import { INK_BUTTON, SECONDARY_BUTTON } from '../studia/progress/tokens';
import { draftProblem, emptyDraft, inputFromDraft, type TaskDraft } from './taskDraft';
import { failureMessage, plannerStore } from './plannerStore';
import { TaskFields } from './TaskFields';

interface Props {
  defaults: Partial<TaskDraft>;
  onClose: () => void;
  onCreated?: (task: Task) => void;
}

/**
 * A new task in full («c» from anywhere): title, description, dates, priority, labels, repetition, dossier. Saving
 * waits for the server; a refusal keeps what was typed and says why, in the server's words. An existing task opens
 * in its sheet (`TaskSheet`), which saves each field as it changes.
 */
export function TaskDialog({ defaults, onClose, onCreated }: Props) {
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft(defaults));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
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
      const kind = dossiers.find((d) => d.id === draft.dossierId)?.kind;
      const created = await taskService.create(inputFromDraft(draft, { withDossier: true, origin: kind === 'studio' ? 'studio' : 'lavoro' }));
      plannerStore.getState().changed();
      // The host says where it went when it knows the page's view; else the plain notice.
      if (onCreated) onCreated(created);
      else plannerStore.getState().notify('Compito aggiunto');
      onClose();
    } catch (failure) {
      setError(failureMessage(failure, 'Non riesco a salvare il compito. Riprova.'));
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Nuovo compito"
      size="lg"
      initialFocusRef={titleRef}
      footer={
        <div className="flex w-full justify-end gap-2">
          <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>Annulla</button>
          <button type="submit" form={formId} disabled={busy} className={INK_BUTTON}>
            {busy ? 'Salvo…' : 'Aggiungi'}
          </button>
        </div>
      }
    >
      <form id={formId} onSubmit={save} noValidate className="grid gap-5">
        {error && (
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
        )}
        <TaskFields draft={draft} onChange={setDraft} withText full titleRef={titleRef} />
      </form>
    </Modal>
  );
}
