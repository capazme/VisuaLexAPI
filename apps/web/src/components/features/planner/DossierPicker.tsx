import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Folder, Inbox } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { Z_INDEX } from '../../../constants/zIndex';
import { FOCUS_RING } from '../studia/progress/tokens';
import { FIELD } from './plannerStyles';

const INBOX = "Lista d'ingresso";

interface Props {
  /** '' for none: the inbox. */
  value: string;
  onChange: (dossierId: string) => void;
  /** The id of the label that names the trigger. */
  labelId: string;
}

/**
 * The sheet's dossier, Opus's «project»: a button that opens a field to search the dossiers by title and the list
 * under it (a combobox: the arrows move, Enter chooses, Esc closes and gives the focus back). «Lista d'ingresso» is
 * the first choice, for a task of no dossier.
 */
export function DossierPicker({ value, onChange, labelId }: Props) {
  const id = useId();
  const dossiers = useAppStore((s) => s.dossiers);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const current = value ? dossiers.find((d) => d.id === value)?.title ?? 'Dossier' : INBOX;

  const options = useMemo(() => {
    const words = query.trim().toLocaleLowerCase('it');
    const byTitle = [...dossiers].sort((a, b) => a.title.localeCompare(b.title, 'it'));
    const found = words ? byTitle.filter((d) => d.title.toLocaleLowerCase('it').includes(words)) : byTitle;
    const inbox = !words || INBOX.toLocaleLowerCase('it').includes(words) ? [{ id: '', title: INBOX }] : [];
    return [...inbox, ...found.map((d) => ({ id: d.id, title: d.title }))];
  }, [dossiers, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // The option the arrows reach is kept in sight in the list, which scrolls.
  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, id]);

  const close = (focusTrigger: boolean) => {
    setOpen(false);
    setQuery('');
    if (focusTrigger) triggerRef.current?.focus();
  };

  const choose = (dossierId: string) => {
    close(true);
    if (dossierId !== value) onChange(dossierId);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((at) => (options.length === 0 ? 0 : (at + step + options.length) % options.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[active];
      if (option) choose(option.id);
    } else if (event.key === 'Escape') {
      // The sheet stays open: this Esc closes the list.
      event.preventDefault();
      close(true);
    }
  };

  return (
    <div
      ref={wrapperRef}
      className="relative min-w-0"
      // Tab out of the search closes the list, as a click outside does.
      onBlur={(e) => {
        if (open && !wrapperRef.current?.contains(e.relatedTarget as Node | null)) close(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${id}-current`}
        // The list opens on the dossier chosen now (with no words typed, `options` lists them all).
        onClick={() => (open ? close(false) : (setActive(Math.max(0, options.findIndex((o) => o.id === value))), setOpen(true)))}
        className={cn(
          'flex min-h-[44px] w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-sm text-slate-900 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800',
          FOCUS_RING,
        )}
      >
        {value ? <Folder size={15} aria-hidden className="shrink-0 text-slate-500" /> : <Inbox size={15} aria-hidden className="shrink-0 text-slate-500" />}
        <span id={`${id}-current`} className="min-w-0 flex-1 truncate">{current}</span>
        <ChevronDown size={15} aria-hidden className="shrink-0 text-slate-500" />
      </button>
      {open && (
        <div className={cn('absolute left-0 right-0 mt-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-md dark:border-slate-700 dark:bg-slate-800', Z_INDEX.dropdown)}>
          <input
            autoFocus
            role="combobox"
            aria-label="Cerca un dossier"
            aria-expanded
            aria-controls={`${id}-list`}
            aria-activedescendant={options[active] ? `${id}-option-${active}` : undefined}
            aria-autocomplete="list"
            value={query}
            placeholder="Cerca un dossier"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            autoComplete="off"
            className={FIELD}
          />
          <ul id={`${id}-list`} role="listbox" aria-label="Dossier" className="mt-1 max-h-64 overflow-y-auto">
            {options.map((option, index) => (
              <li
                key={option.id || 'inbox'}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={option.id === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(option.id)}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  'flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-slate-800 dark:text-slate-100',
                  index === active && 'bg-slate-100 dark:bg-slate-700',
                )}
              >
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{option.title}</span>
                {option.id === value && <Check size={15} aria-hidden className="shrink-0 text-primary-700 dark:text-primary-300" />}
              </li>
            ))}
            {options.length === 0 && <li className="px-2 py-3 text-sm text-slate-600 dark:text-slate-400">Nessun dossier con queste parole.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
