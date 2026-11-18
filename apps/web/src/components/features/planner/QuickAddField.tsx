import { useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ChevronDown, Folder, Plus, SlidersHorizontal, X } from 'lucide-react';
import { FIELD_TEXT } from '../../../constants/interactions';
import { Collapsible } from '../../ui/Collapsible';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { taskService } from '../../../services/taskService';
import type { TaskView } from '../../../types/tasks';
import { FOCUS_RING, INK_BUTTON } from '../studia/progress/tokens';
import { belongsTo, draftProblem, emptyDraft, inputFromDraft, MAX_TITLE, type TaskDraft } from './taskDraft';
import { PRIORITY_LABEL, RECURRENCE_LABEL, shortDay } from './taskDates';
import { draftWithLine, readQuickAddLine, suggestDossiers, type DossierName, type FoundPart } from './quickAddLine';
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

/** Where a new task is going, in a line under the field: its day and time, deadline, priority, labels and place. */
function summary(draft: TaskDraft, today: string, dossierTitle: string | undefined): string {
  const parts: string[] = [];
  const at = (time: string) => (time ? ` alle ${time}` : '');
  parts.push(draft.plannedDate ? `Per ${shortDay(draft.plannedDate, today).toLowerCase()}${at(draft.plannedTime)}` : 'Senza data');
  if (draft.dueDate) parts.push(`termine finale ${shortDay(draft.dueDate, today).toLowerCase()}${at(draft.dueTime)}`);
  if (draft.priority < 4) parts.push(`priorità ${PRIORITY_LABEL[draft.priority].toLowerCase()}`);
  const labels = draft.labels.split(',').map((label) => label.trim()).filter(Boolean);
  if (labels.length > 0) parts.push(`${labels.length === 1 ? 'etichetta' : 'etichette'} ${labels.map((label) => `«${label}»`).join(', ')}`);
  parts.push(draft.dossierId ? `nella pratica «${dossierTitle ?? '…'}»` : "nella lista d'ingresso");
  return parts.join(' · ');
}

/** A part read from the line, in words, on its chip. */
function partLabel(part: FoundPart, today: string): string {
  const at = (time: string | null) => (time ? ` alle ${time}` : '');
  switch (part.kind) {
    case 'date': {
      const { date, time, recurrence, recurrenceFrom } = part.value;
      if (!recurrence) return `${shortDay(date, today)}${at(time)}`;
      const from = recurrenceFrom === 'completamento' ? ', dal completamento' : '';
      return `${RECURRENCE_LABEL[recurrence]}${at(time)}${from}, da ${shortDay(date, today).toLowerCase()}`;
    }
    case 'due':
      return `Termine finale ${shortDay(part.value.date, today).toLowerCase()}${at(part.value.time)}`;
    case 'dossier':
      return `Pratica «${part.title}»`;
    case 'label':
      return `Etichetta «${part.label}»`;
    case 'priority':
      return `Priorità ${PRIORITY_LABEL[part.priority].toLowerCase()}`;
  }
}

/**
 * The field at the top of each view: a title and Enter. The line is read as it is typed (LC78, `quickAddLine.ts`): a
 * date in words, `#pratica`, `@etichetta`, `p1`–`p4` and `{termine}`; what was read shows as chips in a row under the
 * field, in the flow (L-73: nothing over the content), and a chip clicked turns its words back into text. The
 * dossiers a `#` may mean are listed there too. «Dettagli» opens the dates, the priority and the dossier in a
 * `ui/Collapsible` under the row (U1b: the box grows, never a jump); what the line says wins over them.
 */
export function QuickAddField({ view, today, defaults, dossierLocked = false }: Props) {
  const id = useId();
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft(defaults));
  const [open, setOpen] = useState(false);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(-1);
  // The `#…` whose list Esc closed, until it changes.
  const [closedQuery, setClosedQuery] = useState<string | null>(null);
  const caretTo = useRef<number | null>(null);
  const dossiers = useAppStore((s) => s.dossiers);
  const line = useMemo(
    () => readQuickAddLine(draft.title, today, { dossiers, dossierLocked, dismissed, caret }),
    [draft.title, today, dossiers, dossierLocked, dismissed, caret],
  );
  const task = useMemo(() => draftWithLine(draft, line), [draft, line]);
  const queryKey = line.dossierQuery ? `${line.dossierQuery.start}:${line.dossierQuery.query}` : null;
  const listOpen = line.dossierQuery !== null && queryKey !== closedQuery;
  const suggestions: DossierName[] = listOpen ? suggestDossiers(line.dossierQuery!.query, dossiers) : [];
  const dossierTitle = task.dossierId ? dossiers.find((d) => d.id === task.dossierId)?.title : undefined;
  const dossierKind = task.dossierId ? dossiers.find((d) => d.id === task.dossierId)?.kind : undefined;

  // A dossier chosen from the list puts the caret after its name.
  useLayoutEffect(() => {
    if (caretTo.current === null) return;
    titleRef.current?.setSelectionRange(caretTo.current, caretTo.current);
    caretTo.current = null;
  });

  const setTitle = (title: string, at: number) => {
    setDraft((current) => ({ ...current, title }));
    setCaret(at);
    setActive(-1);
    if (!title) setDismissed(new Set());
  };

  const choose = (dossier: DossierName) => {
    const query = line.dossierQuery!;
    const rest = draft.title.slice(query.end);
    const inserted = `#${dossier.title}${/^\s/.test(rest) ? '' : ' '}`;
    caretTo.current = query.start + inserted.length;
    setTitle(draft.title.slice(0, query.start) + inserted + rest, caretTo.current);
    titleRef.current?.focus();
  };

  const dismiss = (part: FoundPart) => {
    setDismissed((current) => new Set(current).add(part.key));
    titleRef.current?.focus();
  };

  const onTitleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!listOpen) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (suggestions.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((at) => (at < 0 && step < 0 ? suggestions.length - 1 : (at + step + suggestions.length) % suggestions.length));
    } else if (event.key === 'Enter' && suggestions[active]) {
      event.preventDefault();
      choose(suggestions[active]);
    } else if (event.key === 'Escape') {
      // This Esc closes the list; the next one empties the title.
      event.preventDefault();
      event.stopPropagation();
      setClosedQuery(queryKey);
      setActive(-1);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !task.title.trim()) return;
    const problem = draftProblem(task);
    if (problem) {
      setError(problem);
      setOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await taskService.create(inputFromDraft(task, { withDossier: true, origin: dossierKind === 'studio' ? 'studio' : 'lavoro' }));
      setTitle('', 0);
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
          setTitle('', 0);
        }
      }}
      className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      {/* The field keeps its hint whole — 12 em of its own text, «Aggiungi un compito» and its padding with some room,
          whatever the reader's text size (the field stays 16 px on a phone while the page's rem shrinks) — but never
          wider than its line; where the row has no room for it and the two buttons (a phone), the buttons go under it,
          at the right (it was cut to «Aggiun» at 320 px). The ＋ stays with the field. */}
      <div className="flex flex-wrap items-center gap-1 p-1.5">
        <div className="flex min-w-0 flex-[1_1_auto] items-center gap-1">
          <Plus size={18} aria-hidden className="ml-2 shrink-0 text-slate-500 dark:text-slate-400" />
          <label htmlFor={`${id}-title`} className="sr-only">Nuovo compito</label>
          <input
            ref={titleRef}
            id={`${id}-title`}
            value={draft.title}
            maxLength={MAX_TITLE}
            onChange={(e) => setTitle(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
            onKeyDown={onTitleKey}
            placeholder="Aggiungi un compito"
            aria-describedby={`${id}-summary`}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
            aria-controls={suggestions.length > 0 ? `${id}-dossiers` : undefined}
            aria-activedescendant={suggestions[active] ? `${id}-dossier-${active}` : undefined}
            autoComplete="off"
            className={cn('min-h-[44px] min-w-[min(12em,100%)] flex-1 rounded-lg bg-transparent px-2 text-slate-900 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 dark:text-slate-100 dark:placeholder:text-slate-500 dark:placeholder:text-slate-400', FIELD_TEXT)}
          />
        </div>
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
          <button type="submit" disabled={busy || !task.title.trim()} className={cn(INK_BUTTON, 'shrink-0 px-3 sm:px-4')}>
            {busy ? 'Aggiungo…' : <>Aggiungi<span className="sr-only"> il compito</span></>}
          </button>
        </div>
      </div>
      {/* What the line says, in the flow under the field: a chip clicked turns its words back into text. */}
      {line.parts.length > 0 && (
        <ul aria-label="Letto nella riga" className="flex flex-wrap gap-x-1 px-2.5">
          {line.parts.map((part) => (
            <li key={part.key}>
              <button
                type="button"
                onClick={() => dismiss(part)}
                aria-label={`${partLabel(part, today)}: togli, «${part.raw}» resta nel titolo`}
                className={cn('group inline-flex min-h-[44px] max-w-full items-center rounded-lg px-0.5', FOCUS_RING)}
              >
                <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-900 group-hover:border-primary-400 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-100">
                  <span className="truncate">{partLabel(part, today)}</span>
                  <X size={12} aria-hidden className="shrink-0" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {listOpen && (
        suggestions.length > 0 ? (
          <ul id={`${id}-dossiers`} role="listbox" aria-label="Pratiche" className="mx-1.5 mb-1 border-t border-slate-200 pt-1 dark:border-slate-800">
            {suggestions.map((dossier, index) => (
              <li
                key={dossier.id}
                id={`${id}-dossier-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(dossier)}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  'flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm text-slate-800 dark:text-slate-100',
                  index === active && 'bg-slate-100 dark:bg-slate-800',
                )}
              >
                <Folder size={15} aria-hidden className="shrink-0 text-slate-500" />
                <span className="min-w-0 truncate">{dossier.title}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={cn(FIELD_HINT, 'px-4 pb-1')}>
            {line.dossierQuery!.query.trim() ? `Nessuna pratica «${line.dossierQuery!.query.trim()}»: resta nel titolo.` : 'Nessuna pratica.'}
          </p>
        )
      )}
      {/* Only once there is a task to sum up (LC83). Always mounted, empty when idle, and polite: what the line read is
          said aloud as it changes, since the chips come in silently. */}
      <p id={`${id}-summary`} aria-live="polite" className={cn(FIELD_HINT, 'px-4 pb-2 empty:p-0')}>
        {draft.title.trim() ? summary(task, today, dossierTitle) : ''}
        {line.lockedHash && ' · In una pratica il compito resta qui: «#» resta nel titolo.'}
      </p>
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
