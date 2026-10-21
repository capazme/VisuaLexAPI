import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, MoreHorizontal, Plus, type LucideIcon } from 'lucide-react';
import { MenuButton } from '../../ui/MenuButton';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { taskService } from '../../../services/taskService';
import type { TaskView } from '../../../types/tasks';
import { FOCUS_RING, QUIET_BUTTON, SECONDARY_BUTTON } from '../studia/progress/tokens';
import { failureMessage, plannerStore } from './plannerStore';
import { belongsTo, emptyDraft, inputFromDraft, MAX_TITLE, type TaskDraft } from './taskDraft';
import { FIELD, ICON_BUTTON } from './plannerStyles';

export const GROUP_HEADING = 'font-serif text-lg font-medium text-slate-900 dark:text-slate-50';
const COUNT = 'ml-2 font-sans text-sm font-normal text-slate-600 dark:text-slate-400';

export interface GroupAdd {
  view: TaskView;
  today: string;
  /** What a task added here starts with: the group's day, its dossier. */
  defaults: Partial<TaskDraft>;
}

interface Props {
  /** The section's id, for a link or a scroll to it (a day of «Prossimi giorni»). */
  anchorId?: string;
  /** The group's key in `plannerStore.folded`, for the session: «today:missed», «upcoming:2026-10-22», «today:dossier:…». */
  foldKey: string;
  heading: string;
  count: number;
  /** «+ Aggiungi compito» under the rows, with the group's day or dossier. */
  add?: GroupAdd;
  /** Actions of the group's «⋯» besides «Aggiungi un compito» (the dossier's «Apri il dossier»). */
  actions?: { label: string; icon: LucideIcon; onSelect: () => void }[];
  children: ReactNode;
}

/**
 * A group of a view, folded and opened by its heading (the accordion pattern: the toggle inside the `h3`, named by
 * the heading's own words, its state `aria-expanded`): the arrow, the name, the count, «⋯»; then its rows and «+
 * Aggiungi compito». Folding is instant: nothing moves, under reduced motion or not, but the arrow's turn.
 */
export function TaskGroup({ anchorId, foldKey, heading, count, add, actions = [], children }: Props) {
  const id = useId();
  const folded = plannerStore((s) => Boolean(s.folded[foldKey]));
  const [adding, setAdding] = useState(0);
  const spent = useCallback(() => setAdding(0), []);
  const menu = [
    ...(add ? [{ label: 'Aggiungi un compito', icon: Plus, onSelect: () => {
      if (folded) plannerStore.getState().toggleFolded(foldKey);
      setAdding((n) => n + 1);
    } }] : []),
    ...actions,
  ];
  return (
    // Clear of the week's strip, which sticks at the top, when the view scrolls to it.
    <section id={anchorId} aria-labelledby={`${id}-heading`} className="min-w-0 scroll-mt-40">
      <div className="flex items-center gap-1 border-b border-slate-300 dark:border-slate-700">
        <h3 id={`${id}-heading`} className={cn(GROUP_HEADING, 'min-w-0 flex-1')}>
          <button
            type="button"
            aria-expanded={!folded}
            aria-controls={folded ? undefined : `${id}-rows`}
            onClick={() => plannerStore.getState().toggleFolded(foldKey)}
            className={cn('-ml-1 flex min-h-[44px] w-full items-center gap-1.5 rounded px-1 text-left', FOCUS_RING)}
          >
            <ChevronDown size={16} aria-hidden className={cn('shrink-0 text-slate-500 transition-transform motion-reduce:transition-none', folded && '-rotate-90')} />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {heading}
              <span className={COUNT}>
                <span className="sr-only">, </span>
                {count}
                <span className="sr-only">{count === 1 ? ' compito' : ' compiti'}</span>
              </span>
            </span>
          </button>
        </h3>
        {menu.length > 0 && (
          <MenuButton label={`Azioni del gruppo: ${heading}`} triggerClassName={ICON_BUTTON} items={menu}>
            <MoreHorizontal size={18} aria-hidden />
          </MenuButton>
        )}
      </div>
      {!folded && (
        <div id={`${id}-rows`}>
          {children}
          {add && <InlineAddTask {...add} openRequest={adding} onOpened={spent} />}
        </div>
      )}
    </section>
  );
}

/**
 * «+ Aggiungi compito» where the list ends: a title and Enter, with the group's day or dossier; the field stays open
 * for the next one, Esc closes it. A task the view will not list is announced, as from the field at the top.
 */
export function InlineAddTask({ view, today, defaults, openRequest = 0, onOpened }: GroupAdd & { openRequest?: number; onOpened?: () => void }) {
  const id = useId();
  const [open, setOpen] = useState(openRequest > 0);
  const [lastRequest, setLastRequest] = useState(openRequest);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const kind = useAppStore((s) => (defaults.dossierId ? s.dossiers.find((d) => d.id === defaults.dossierId)?.kind : undefined));

  // The group's «⋯» asked for the field: open it (a prop that changed, read during render).
  if (openRequest !== lastRequest) {
    setLastRequest(openRequest);
    if (openRequest > 0) setOpen(true);
  }
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    // The request is spent: folding and opening the group again does not open the field by itself.
    if (lastRequest > 0) onOpened?.();
  }, [open, lastRequest, onOpened]);

  const close = () => {
    setOpen(false);
    setTitle('');
    setError(null);
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const draft = emptyDraft({ ...defaults, title: trimmed });
      const created = await taskService.create(inputFromDraft(draft, { withDossier: true, origin: kind === 'studio' ? 'studio' : 'lavoro' }));
      setTitle('');
      plannerStore.getState().changed();
      if (!belongsTo(created, view, today, view === 'dossier' ? defaults.dossierId || undefined : undefined)) {
        plannerStore.getState().notify('Compito aggiunto: non è in questa vista', 'info');
      }
    } catch (failure) {
      setError(failureMessage(failure, 'Non riesco ad aggiungere il compito. Riprova.'));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  if (!open) {
    return (
      <button ref={buttonRef} type="button" onClick={() => setOpen(true)} className={cn(QUIET_BUTTON, 'mx-0 mt-1 inline-flex items-center gap-2 px-1 font-normal text-slate-700 dark:text-slate-300')}>
        <Plus size={16} aria-hidden className="text-primary-700 dark:text-primary-300" />
        Aggiungi compito
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      }}
      className="mt-2 grid gap-2 rounded-xl border border-slate-200 p-2 dark:border-slate-800"
    >
      <label htmlFor={`${id}-title`} className="sr-only">Nuovo compito</label>
      <input
        ref={inputRef}
        id={`${id}-title`}
        value={title}
        maxLength={MAX_TITLE}
        placeholder="Titolo del compito"
        onChange={(e) => setTitle(e.target.value)}
        autoComplete="off"
        className={FIELD}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={close} className={cn(QUIET_BUTTON, 'mx-0 px-3')}>Annulla</button>
        <button type="submit" disabled={busy || !title.trim()} className={SECONDARY_BUTTON}>
          {busy ? 'Aggiungo…' : <>Aggiungi<span className="sr-only"> il compito</span></>}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-800 dark:text-red-200">{error}</p>}
    </form>
  );
}
