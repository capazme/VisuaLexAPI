import { useId, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, Plus, SlidersHorizontal } from 'lucide-react';
import { FIELD_TEXT } from '../../../constants/interactions';
import { Collapsible } from '../../ui/Collapsible';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { taskService } from '../../../services/taskService';
import type { TaskView } from '../../../types/tasks';
import { INK_BUTTON } from '../studia/progress/tokens';
import { belongsTo, draftProblem, emptyDraft, inputFromDraft, MAX_TITLE, type TaskDraft } from './taskDraft';
import { PRIORITY_LABEL, shortDay } from './taskDates';
import { failureMessage, plannerStore } from './plannerStore';
import { TaskFields } from './TaskFields';
import { FIELD_HINT, ICON_BUTTON } from './plannerStyles';

interface Props {
  /** The view it sits on: a task that will not show there is announced. */
  view: TaskView;
  today: string;
  /** What a new task starts with: today's date on «Oggi», the dossier in its panel. */
  defaults: Partial<TaskDraft>;
  /** The dossier panel's: the dossier is fixed. */
  dossierLocked?: boolean;
}

/** Where a new task is going, in a line under the field. */
function summary(draft: TaskDraft, today: string, dossierTitle: string | undefined): string {
  const parts: string[] = [];
  parts.push(draft.plannedDate ? `Per ${shortDay(draft.plannedDate, today).toLowerCase()}` : 'Senza data');
  if (draft.dueDate) parts.push(`termine finale ${shortDay(draft.dueDate, today).toLowerCase()}`);
  if (draft.priority < 4) parts.push(`priorità ${PRIORITY_LABEL[draft.priority].toLowerCase()}`);
  parts.push(draft.dossierId ? `nel dossier «${dossierTitle ?? '…'}»` : "nella lista d'ingresso");
  return parts.join(' · ');
}

/**
 * The field at the top of each view: a title and Enter. «Dettagli» opens the dates, the priority and the dossier in a
 * `ui/Collapsible` under the row (U1b: the box grows, never a jump); the full set (labels, repetition, description) is
 * the task's dialog. No date is read from the words (wave 2).
 */
export function QuickAddField({ view, today, defaults, dossierLocked = false }: Props) {
  const id = useId();
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft(defaults));
  const [open, setOpen] = useState(false);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dossierTitle = useAppStore((s) => (draft.dossierId ? s.dossiers.find((d) => d.id === draft.dossierId)?.title : undefined));
  const dossierKind = useAppStore((s) => (draft.dossierId ? s.dossiers.find((d) => d.id === draft.dossierId)?.kind : undefined));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !draft.title.trim()) return;
    const problem = draftProblem(draft);
    if (problem) {
      setError(problem);
      setOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await taskService.create(inputFromDraft(draft, { withDossier: true, origin: dossierKind === 'studio' ? 'studio' : 'lavoro' }));
      setDraft((current) => ({ ...current, title: '' }));
      plannerStore.getState().changed();
      if (!belongsTo(created, view, today, defaults.dossierId || undefined)) plannerStore.getState().notify('Compito aggiunto: non è in questa vista', 'info');
    } catch (failure) {
      setError(failureMessage(failure, 'Non riesco ad aggiungere il compito. Riprova.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && draft.title && e.target instanceof HTMLInputElement && e.target.id === `${id}-title`) {
          e.preventDefault();
          setDraft((current) => ({ ...current, title: '' }));
        }
      }}
      className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      {/* The field keeps its hint whole (11.5 rem: «Aggiungi un compito» and its padding); where the row has no room for
          it and the two buttons — a phone, the dossier's narrow panel — the buttons go under it, at the right (it was cut
          to «Aggiun» at 320 px). */}
      <div className="flex flex-wrap items-center gap-1 p-1.5">
        <Plus size={18} aria-hidden className="ml-2 shrink-0 text-slate-500 dark:text-slate-400" />
        <label htmlFor={`${id}-title`} className="sr-only">Nuovo compito</label>
        <input
          id={`${id}-title`}
          value={draft.title}
          maxLength={MAX_TITLE}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="Aggiungi un compito"
          aria-describedby={`${id}-summary`}
          autoComplete="off"
          className={cn('min-h-[44px] min-w-[11.5rem] flex-1 rounded-lg bg-transparent px-2 text-slate-900 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 dark:text-slate-100 dark:placeholder:text-slate-400', FIELD_TEXT)}
        />
        <div className="ml-auto flex items-center gap-1">
          <button
            ref={detailsButton}
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-details`}
            onClick={() => setOpen((v) => !v)}
            // In a row at every width: the planner's icon button is a grid, which stacked the icon over the arrow.
            className={cn(ICON_BUTTON, 'inline-flex gap-1.5 px-2 sm:px-3', open && 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-50')}
          >
            <SlidersHorizontal size={16} aria-hidden />
            <span className="sr-only sm:not-sr-only sm:text-sm sm:font-medium">Dettagli</span>
            {/* Turns as the panel opens, with its height: the button's state at every width. */}
            <ChevronDown size={14} aria-hidden className={cn('shrink-0 transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-180')} />
          </button>
          <button type="submit" disabled={busy || !draft.title.trim()} className={cn(INK_BUTTON, 'shrink-0 px-3 sm:px-4')}>
            {busy ? 'Aggiungo…' : <>Aggiungi<span className="sr-only"> il compito</span></>}
          </button>
        </div>
      </div>
      <p id={`${id}-summary`} className={cn(FIELD_HINT, 'px-4 pb-2')}>{summary(draft, today, dossierTitle)}</p>
      <Collapsible
        id={`${id}-details`}
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={detailsButton}
        contentClassName="border-t border-slate-200 p-3 dark:border-slate-800"
      >
        <TaskFields draft={draft} onChange={setDraft} dossierLocked={dossierLocked} />
      </Collapsible>
      {error && (
        <p role="alert" className="border-t border-slate-200 px-4 py-2 text-sm text-red-800 dark:border-slate-800 dark:text-red-200">
          {error}
        </p>
      )}
    </form>
  );
}
