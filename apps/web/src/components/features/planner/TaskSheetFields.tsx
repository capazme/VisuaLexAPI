import { useId, useState, type ReactNode } from 'react';
import { Flag, Hourglass, X } from 'lucide-react';
import { MenuButton } from '../../ui/MenuButton';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { RECURRENCE_RULES, type RecurrenceFrom, type RecurrenceRule, type Task, type TaskInput, type TaskPriority } from '../../../types/tasks';
import { tagLabel } from '../../../utils/tagLabel';
import { DossierPicker } from './DossierPicker';
import { countdown, PRIORITY_LABEL, RECURRENCE_FROM_LABEL, RECURRENCE_LABEL } from './taskDates';
import { parseLabels } from './taskDraft';
import { DEADLINE_TONE, FIELD, FIELD_HINT, ICON_BUTTON, PRIORITY_FLAG } from './plannerStyles';

/** A change from the sheet: what to show at once, and what to send. */
export type SheetSave = (shown: Partial<Task>, input: TaskInput) => void;

interface Props {
  task: Task;
  today: string;
  onSave: SheetSave;
}

const ROW_LABEL = 'text-sm font-medium text-slate-700 dark:text-slate-300';

function FieldRow({ label, labelFor, labelId, children }: { label: string; labelFor?: string; labelId?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-slate-200 py-3 last:border-b-0 dark:border-slate-800">
      {labelFor ? (
        <label htmlFor={labelFor} id={labelId} className={ROW_LABEL}>{label}</label>
      ) : (
        <span id={labelId} className={ROW_LABEL}>{label}</span>
      )}
      {children}
    </div>
  );
}

/** A day and its time, side by side; clearing the day clears the time, which waits for a day. */
function DayAndTime({ day, time, dayLabel, timeLabel, disabled, describedBy, onDay, onTime, id }: {
  day: string | null;
  time: string | null;
  dayLabel: string;
  timeLabel: string;
  disabled?: boolean;
  describedBy?: string;
  onDay: (day: string) => void;
  onTime: (time: string) => void;
  id: string;
}) {
  return (
    <div className="flex min-w-0 gap-2">
      <input
        id={id}
        type="date"
        aria-label={dayLabel}
        aria-describedby={describedBy}
        value={day ?? ''}
        disabled={disabled}
        onChange={(e) => onDay(e.target.value)}
        className={cn(FIELD, 'min-w-0 flex-1 px-2')}
      />
      <input
        type="time"
        aria-label={timeLabel}
        value={time ?? ''}
        disabled={disabled || !day}
        onChange={(e) => onTime(e.target.value)}
        className={cn(FIELD, 'w-[6.5rem] shrink-0 px-2')}
      />
    </div>
  );
}

/**
 * The sheet's column of fields, in the order the brief sets — Dossier, Data pianificata, Termine finale, Priorità,
 * Etichette — and the repetition last. Each saves when it changes (`onSave`); a subtask's dossier is its parent's and
 * is shown, not chosen. A repetition and a deadline switch each other off and say why, as in the quick add.
 */
export function TaskSheetFields({ task, today, onSave }: Props) {
  const id = useId();
  const dossiers = useAppStore((s) => s.dossiers);
  const [newLabel, setNewLabel] = useState('');
  const due = task.dueDate ? countdown(task.dueDate, today) : null;
  const parentDossier = task.dossierId ? dossiers.find((d) => d.id === task.dossierId)?.title ?? 'Dossier' : "Lista d'ingresso";

  const moveTo = (dossierId: string) => {
    // A task moved to another dossier takes that dossier's kind as its origin (a dossier di studio: «studio»).
    const kind = dossiers.find((d) => d.id === dossierId)?.kind;
    const origin = task.origin === 'forum' ? undefined : kind === 'studio' ? 'studio' : 'lavoro';
    onSave({ dossierId: dossierId || null, ...(origin ? { origin } : {}) }, { dossierId: dossierId || null, ...(origin ? { origin } : {}) });
  };

  const addLabels = () => {
    const labels = parseLabels([...task.labels, newLabel].join(','));
    setNewLabel('');
    if (labels.length !== task.labels.length) onSave({ labels }, { labels });
  };

  return (
    <div className="grid min-w-0 grid-cols-1">
      <FieldRow label="Dossier" labelId={`${id}-dossier`}>
        {task.parentId ? (
          <p className="px-2 py-2 text-sm text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">
            {parentDossier}
            <span className={cn('block', FIELD_HINT)}>Come il compito principale.</span>
          </p>
        ) : (
          <DossierPicker value={task.dossierId ?? ''} onChange={moveTo} labelId={`${id}-dossier`} />
        )}
      </FieldRow>

      <FieldRow label="Data pianificata" labelFor={`${id}-planned`}>
        <DayAndTime
          id={`${id}-planned`}
          day={task.plannedDate}
          time={task.plannedTime}
          dayLabel="Data pianificata"
          timeLabel="Ora pianificata"
          onDay={(day) => onSave({ plannedDate: day || null, ...(day ? {} : { plannedTime: null }) }, { plannedDate: day || null, ...(day ? {} : { plannedTime: null }) })}
          onTime={(time) => onSave({ plannedTime: time || null }, { plannedTime: time || null })}
        />
      </FieldRow>

      <FieldRow label="Termine finale" labelFor={`${id}-due`}>
        <DayAndTime
          id={`${id}-due`}
          day={task.dueDate}
          time={task.dueTime}
          dayLabel="Termine finale"
          timeLabel="Ora del termine finale"
          disabled={task.recurrence !== null}
          describedBy={`${id}-due-hint`}
          onDay={(day) => onSave({ dueDate: day || null, ...(day ? {} : { dueTime: null }) }, { dueDate: day || null, ...(day ? {} : { dueTime: null }) })}
          onTime={(time) => onSave({ dueTime: time || null }, { dueTime: time || null })}
        />
        <p id={`${id}-due-hint`} className={FIELD_HINT}>
          {task.recurrence ? (
            'Un compito che si ripete non ha termine finale.'
          ) : due ? (
            <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold', DEADLINE_TONE[due.tone])}>
              <Hourglass size={12} aria-hidden />
              {due.tone === 'today' ? 'Scade oggi' : due.text.charAt(0).toUpperCase() + due.text.slice(1)}
            </span>
          ) : (
            'Entro quando va fatto: non si sposta.'
          )}
        </p>
      </FieldRow>

      <FieldRow label="Priorità" labelId={`${id}-priority`}>
        <MenuButton
          label={`Priorità: ${PRIORITY_LABEL[task.priority]}`}
          align="left"
          className="w-full"
          triggerClassName="flex min-h-[44px] w-full items-center gap-2 px-2 text-sm text-slate-900 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
          items={([1, 2, 3, 4] as const).map((p: TaskPriority) => ({
            label: PRIORITY_LABEL[p],
            icon: Flag,
            iconClassName: PRIORITY_FLAG[p],
            checked: p === task.priority,
            onSelect: () => {
              if (p !== task.priority) onSave({ priority: p }, { priority: p });
            },
          }))}
        >
          <Flag size={15} aria-hidden className={cn('shrink-0', PRIORITY_FLAG[task.priority])} />
          {PRIORITY_LABEL[task.priority]}
        </MenuButton>
      </FieldRow>

      <FieldRow label="Etichette" labelFor={`${id}-labels`}>
        {task.labels.length > 0 && (
          <ul aria-label="Etichette del compito" className="flex flex-wrap gap-x-1.5 gap-y-3 py-2">
            {task.labels.map((label) => (
              <li key={label} className="inline-flex max-w-full items-center rounded-md bg-slate-100 pl-2 text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                <span className="min-w-0 truncate">{tagLabel(label)}</span>
                <button
                  type="button"
                  aria-label={`Togli l'etichetta ${tagLabel(label)}`}
                  onClick={() => {
                    const labels = task.labels.filter((l) => l !== label);
                    onSave({ labels }, { labels });
                  }}
                  // 44 px for a finger, its extra height laid over the gaps (the chip stays its height).
                  className={cn(ICON_BUTTON, '-my-2.5 hover:bg-transparent dark:hover:bg-transparent')}
                >
                  <X size={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          id={`${id}-labels`}
          value={newLabel}
          placeholder="Aggiungi un'etichetta"
          aria-describedby={`${id}-labels-hint`}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              if (newLabel.trim()) addLabels();
            }
          }}
          onBlur={() => {
            if (newLabel.trim()) addLabels();
          }}
          autoComplete="off"
          className={cn(FIELD, 'px-2')}
        />
        <p id={`${id}-labels-hint`} className={FIELD_HINT}>Invio o virgola per aggiungerla.</p>
      </FieldRow>

      <FieldRow label="Ripetizione" labelFor={`${id}-recurrence`}>
        <select
          id={`${id}-recurrence`}
          value={task.recurrence ?? ''}
          disabled={task.dueDate !== null}
          aria-describedby={`${id}-recurrence-hint`}
          onChange={(e) => {
            const recurrence = (e.target.value || null) as RecurrenceRule | null;
            onSave({ recurrence }, { recurrence, ...(recurrence ? { recurrenceFrom: task.recurrenceFrom } : {}) });
          }}
          className={cn(FIELD, 'px-2')}
        >
          <option value="">Non si ripete</option>
          {Object.values(RECURRENCE_RULES).map((rule) => (
            <option key={rule} value={rule}>{RECURRENCE_LABEL[rule]}</option>
          ))}
        </select>
        {task.recurrence && (
          <select
            aria-label="Conta"
            value={task.recurrenceFrom}
            onChange={(e) => {
              const recurrenceFrom = e.target.value as RecurrenceFrom;
              onSave({ recurrenceFrom }, { recurrenceFrom });
            }}
            className={cn(FIELD, 'mt-1 px-2')}
          >
            {(['pianificata', 'completamento'] as const).map((from) => (
              <option key={from} value={from}>Conta {RECURRENCE_FROM_LABEL[from]}</option>
            ))}
          </select>
        )}
        <p id={`${id}-recurrence-hint`} className={FIELD_HINT}>
          {task.dueDate
            ? 'Un compito con un termine finale non si ripete.'
            : task.recurrence === RECURRENCE_RULES.workingDays
              ? 'Dal lunedì al venerdì, festività nazionali escluse.'
              : task.recurrence
                ? 'Alla spunta il compito torna alla data successiva.'
                : 'Richiede la data pianificata.'}
        </p>
      </FieldRow>
    </div>
  );
}
