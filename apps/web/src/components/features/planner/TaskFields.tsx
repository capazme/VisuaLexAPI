import { useId } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { isStudiaEnabled } from '../../../features/studia/featureFlag';
import { RECURRENCE_RULES, type RecurrenceFrom, type RecurrenceRule, type TaskPriority } from '../../../types/tasks';
import { cn } from '../../../lib/utils';
import { MAX_DESCRIPTION, MAX_TITLE, type TaskDraft } from './taskDraft';
import { PRIORITY_LABEL, RECURRENCE_FROM_LABEL, RECURRENCE_LABEL } from './taskDates';
import { FIELD, FIELD_HINT, FIELD_LABEL } from './plannerStyles';

interface Props {
  draft: TaskDraft;
  onChange: (next: TaskDraft) => void;
  /** The quick-add field types the title itself; the dialog shows it here, with the description. */
  withText?: boolean;
  /** A subtask's dossier is its parent's; the dossier panel's is its own. Shown, not chosen. */
  dossierLocked?: boolean;
  /** Labels and repetition are the dialog's; the quick add keeps to dates, priority and dossier. */
  full?: boolean;
  titleRef?: React.Ref<HTMLInputElement>;
}

/**
 * A task's fields, for the dialog and the quick add's details. The deadline is what the user writes: nothing here
 * proposes or computes one. A repetition and a deadline exclude each other (the deadline does not move), so each
 * switches the other off and says why.
 */
export function TaskFields({ draft, onChange, withText = false, dossierLocked = false, full = false, titleRef }: Props) {
  const id = useId();
  const dossiers = useAppStore((s) => s.dossiers);
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => onChange({ ...draft, [key]: value });
  const studia = isStudiaEnabled();
  const byTitle = [...dossiers].sort((a, b) => a.title.localeCompare(b.title, 'it'));
  const groups = studia
    ? [
        { label: 'Dossier di lavoro', items: byTitle.filter((d) => d.kind !== 'studio') },
        { label: 'Dossier di studio', items: byTitle.filter((d) => d.kind === 'studio') },
      ].filter((g) => g.items.length > 0)
    : [{ label: '', items: byTitle }];
  const lockedTitle = dossierLocked && draft.dossierId ? dossiers.find((d) => d.id === draft.dossierId)?.title ?? 'Dossier' : null;

  return (
    <div className="grid grid-cols-1 gap-4">
      {withText && (
        <>
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-title`} className={FIELD_LABEL}>Titolo</label>
            <input
              ref={titleRef}
              id={`${id}-title`}
              value={draft.title}
              maxLength={MAX_TITLE}
              onChange={(e) => set('title', e.target.value)}
              className={FIELD}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-description`} className={FIELD_LABEL}>Descrizione</label>
            <textarea
              id={`${id}-description`}
              value={draft.description}
              maxLength={MAX_DESCRIPTION}
              rows={3}
              onChange={(e) => set('description', e.target.value)}
              className={cn(FIELD, 'py-2')}
              aria-describedby={`${id}-description-hint`}
            />
            <p id={`${id}-description-hint`} className={FIELD_HINT}>Gli indirizzi web diventano link.</p>
          </div>
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="grid gap-1.5">
          <legend className={cn(FIELD_LABEL, 'mb-1.5')}>Data pianificata</legend>
          <div className="flex gap-2">
            <input
              type="date"
              aria-label="Data pianificata"
              value={draft.plannedDate}
              onChange={(e) => onChange({ ...draft, plannedDate: e.target.value, ...(e.target.value ? {} : { plannedTime: '' }) })}
              className={cn(FIELD, 'flex-1')}
            />
            <input
              type="time"
              aria-label="Ora pianificata"
              value={draft.plannedTime}
              disabled={!draft.plannedDate}
              onChange={(e) => set('plannedTime', e.target.value)}
              className={cn(FIELD, 'w-28 shrink-0')}
            />
          </div>
          <p className={FIELD_HINT}>Quando pensi di farlo.</p>
        </fieldset>

        <fieldset className="grid gap-1.5">
          <legend className={cn(FIELD_LABEL, 'mb-1.5')}>Termine finale</legend>
          <div className="flex gap-2">
            <input
              type="date"
              aria-label="Termine finale"
              aria-describedby={`${id}-due-hint`}
              value={draft.dueDate}
              disabled={draft.recurrence !== ''}
              onChange={(e) => onChange({ ...draft, dueDate: e.target.value, ...(e.target.value ? {} : { dueTime: '' }) })}
              className={cn(FIELD, 'flex-1')}
            />
            <input
              type="time"
              aria-label="Ora del termine finale"
              value={draft.dueTime}
              disabled={!draft.dueDate}
              onChange={(e) => set('dueTime', e.target.value)}
              className={cn(FIELD, 'w-28 shrink-0')}
            />
          </div>
          <p id={`${id}-due-hint`} className={FIELD_HINT}>
            {draft.recurrence ? 'Un compito che si ripete non ha termine finale.' : 'Entro quando va fatto: non si sposta.'}
          </p>
        </fieldset>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-priority`} className={FIELD_LABEL}>Priorità</label>
          <select
            id={`${id}-priority`}
            value={draft.priority}
            onChange={(e) => set('priority', Number(e.target.value) as TaskPriority)}
            className={FIELD}
          >
            {([1, 2, 3, 4] as const).map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor={`${id}-dossier`} className={FIELD_LABEL}>Dossier</label>
          {lockedTitle !== null ? (
            <input id={`${id}-dossier`} value={lockedTitle} readOnly disabled className={FIELD} />
          ) : (
            <select id={`${id}-dossier`} value={draft.dossierId} disabled={dossierLocked} onChange={(e) => set('dossierId', e.target.value)} className={FIELD}>
              <option value="">Nessuno: lista d'ingresso</option>
              {groups.map((group) =>
                group.label ? (
                  <optgroup key={group.label} label={group.label}>
                    {group.items.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </optgroup>
                ) : (
                  group.items.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)
                ),
              )}
            </select>
          )}
        </div>
      </div>

      {full && (
        <>
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-labels`} className={FIELD_LABEL}>Etichette</label>
            <input
              id={`${id}-labels`}
              value={draft.labels}
              onChange={(e) => set('labels', e.target.value)}
              className={FIELD}
              aria-describedby={`${id}-labels-hint`}
              autoComplete="off"
            />
            <p id={`${id}-labels-hint`} className={FIELD_HINT}>Separate da una virgola: «udienza, da fatturare».</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-recurrence`} className={FIELD_LABEL}>Ripetizione</label>
              <select
                id={`${id}-recurrence`}
                value={draft.recurrence}
                disabled={draft.dueDate !== ''}
                aria-describedby={`${id}-recurrence-hint`}
                onChange={(e) => set('recurrence', e.target.value as RecurrenceRule | '')}
                className={FIELD}
              >
                <option value="">Non si ripete</option>
                {Object.values(RECURRENCE_RULES).map((rule) => (
                  <option key={rule} value={rule}>{RECURRENCE_LABEL[rule]}</option>
                ))}
              </select>
              <p id={`${id}-recurrence-hint`} className={FIELD_HINT}>
                {draft.dueDate
                  ? 'Un compito con un termine finale non si ripete.'
                  : draft.recurrence === RECURRENCE_RULES.workingDays
                    ? 'Dal lunedì al venerdì, festività nazionali escluse.'
                    : 'Alla spunta il compito torna alla data successiva.'}
              </p>
            </div>
            {draft.recurrence && (
              <div className="grid gap-1.5">
                <label htmlFor={`${id}-from`} className={FIELD_LABEL}>Conta</label>
                <select
                  id={`${id}-from`}
                  value={draft.recurrenceFrom}
                  onChange={(e) => set('recurrenceFrom', e.target.value as RecurrenceFrom)}
                  className={FIELD}
                >
                  {(['pianificata', 'completamento'] as const).map((from) => (
                    <option key={from} value={from}>{RECURRENCE_FROM_LABEL[from]}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
