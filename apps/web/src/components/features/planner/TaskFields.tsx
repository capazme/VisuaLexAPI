import { useId } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { isStudiaEnabled } from '../../../features/studia/featureFlag';
import { RECURRENCE_RULES, type RecurrenceFrom, type RecurrenceRule, type TaskPriority } from '../../../types/tasks';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { Textarea } from '../../ui/Textarea';
import { FIELD_HELP, FIELD_LABEL } from '../../ui/controlStyles';
import { MAX_DESCRIPTION, MAX_TITLE, type TaskDraft } from './taskDraft';
import { PRIORITY_LABEL, RECURRENCE_FROM_LABEL, RECURRENCE_LABEL } from './taskDates';

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
        { label: 'Pratica di lavoro', items: byTitle.filter((d) => d.kind !== 'studio') },
        { label: 'Pratica di studio', items: byTitle.filter((d) => d.kind === 'studio') },
      ].filter((g) => g.items.length > 0)
    : [{ label: '', items: byTitle }];
  const lockedTitle = dossierLocked && draft.dossierId ? dossiers.find((d) => d.id === draft.dossierId)?.title ?? 'Pratica' : null;

  return (
    <div className="grid grid-cols-1 gap-4">
      {withText && (
        <>
          <Input
            ref={titleRef}
            label="Titolo"
            value={draft.title}
            maxLength={MAX_TITLE}
            onChange={(e) => set('title', e.target.value)}
            autoComplete="off"
          />
          <Textarea
            label="Descrizione"
            value={draft.description}
            maxLength={MAX_DESCRIPTION}
            rows={3}
            onChange={(e) => set('description', e.target.value)}
            helperText="Gli indirizzi web diventano link."
          />
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="grid gap-1.5">
          <legend className={FIELD_LABEL}>Data pianificata</legend>
          {/* `Input` fills its box: the boxes take the row's widths. */}
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Input
                type="date"
                aria-label="Data pianificata"
                value={draft.plannedDate}
                onChange={(e) => onChange({ ...draft, plannedDate: e.target.value, ...(e.target.value ? {} : { plannedTime: '' }) })}
              />
            </div>
            <div className="w-28 shrink-0">
              <Input
                type="time"
                aria-label="Ora pianificata"
                value={draft.plannedTime}
                disabled={!draft.plannedDate}
                onChange={(e) => set('plannedTime', e.target.value)}
              />
            </div>
          </div>
          <p className={FIELD_HELP}>Quando pensi di farlo.</p>
        </fieldset>

        <fieldset className="grid gap-1.5">
          <legend className={FIELD_LABEL}>Termine finale</legend>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Input
                type="date"
                aria-label="Termine finale"
                aria-describedby={`${id}-due-hint`}
                value={draft.dueDate}
                disabled={draft.recurrence !== ''}
                onChange={(e) => onChange({ ...draft, dueDate: e.target.value, ...(e.target.value ? {} : { dueTime: '' }) })}
              />
            </div>
            <div className="w-28 shrink-0">
              <Input
                type="time"
                aria-label="Ora del termine finale"
                value={draft.dueTime}
                disabled={!draft.dueDate}
                onChange={(e) => set('dueTime', e.target.value)}
              />
            </div>
          </div>
          <p id={`${id}-due-hint`} className={FIELD_HELP}>
            {draft.recurrence ? 'Un compito che si ripete non ha termine finale.' : 'Entro quando va fatto: non si sposta.'}
          </p>
        </fieldset>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Priorità"
          value={draft.priority}
          onChange={(e) => set('priority', Number(e.target.value) as TaskPriority)}
        >
          {([1, 2, 3, 4] as const).map((p) => (
            <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
          ))}
        </Select>

        <div>
          {lockedTitle !== null ? (
            <Input label="Pratica" value={lockedTitle} readOnly disabled />
          ) : (
            <Select label="Pratica" value={draft.dossierId} disabled={dossierLocked} onChange={(e) => set('dossierId', e.target.value)}>
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
            </Select>
          )}
        </div>
      </div>

      {full && (
        <>
          <Input
            label="Etichette"
            value={draft.labels}
            onChange={(e) => set('labels', e.target.value)}
            helperText="Separate da una virgola: «udienza, da fatturare»."
            autoComplete="off"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Ripetizione"
              value={draft.recurrence}
              disabled={draft.dueDate !== ''}
              onChange={(e) => set('recurrence', e.target.value as RecurrenceRule | '')}
              helperText={draft.dueDate
                ? 'Un compito con un termine finale non si ripete.'
                : draft.recurrence === RECURRENCE_RULES.workingDays
                  ? 'Dal lunedì al venerdì, festività nazionali escluse.'
                  : 'Alla spunta il compito torna alla data successiva.'}
            >
              <option value="">Non si ripete</option>
              {Object.values(RECURRENCE_RULES).map((rule) => (
                <option key={rule} value={rule}>{RECURRENCE_LABEL[rule]}</option>
              ))}
            </Select>
            {draft.recurrence && (
              <Select
                label="Conta"
                value={draft.recurrenceFrom}
                onChange={(e) => set('recurrenceFrom', e.target.value as RecurrenceFrom)}
              >
                {(['pianificata', 'completamento'] as const).map((from) => (
                  <option key={from} value={from}>{RECURRENCE_FROM_LABEL[from]}</option>
                ))}
              </Select>
            )}
          </div>
        </>
      )}
    </div>
  );
}
