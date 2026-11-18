import { useEffect, useRef, useState, type RefObject } from 'react';
import { CheckSquare, FolderInput, FolderMinus, Search, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Expand } from '../../ui/Expand';
import { RowMovePicker } from '../practice/RowDossierPanels';
import { FIELD, ICON_BUTTON } from '../planner/plannerStyles';
import { HEADER_BUTTON } from './dossierStyles';

interface Props {
  dossierId: string;
  /** «Fonti» is the view shown: only then does `/` reach the field. */
  active: boolean;
  query: string;
  onQuery: (value: string) => void;
  /** Rows shown and rows held, for «N di M» while filtering. */
  shown: number;
  total: number;
  selecting: boolean;
  onSelecting: (on: boolean) => void;
  selectedCount: number;
  onMove: (targetId: string) => void;
  onRemove: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * The collection's tools at the top of «Fonti» (LC88): the field that filters the acts, the articles, the decisions and
 * the notes, and «Seleziona», whose bar of actions opens in the flow under it, never fixed over the list (L-73).
 */
export function FontiToolbar({
  dossierId, active, query, onQuery, shown, total, selecting, onSelecting, selectedCount, onMove, onRemove, inputRef,
}: Props) {
  const [moving, setMoving] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const filtering = query.trim() !== '';

  // `/` takes the field, as the dossiers' list does; never while typing elsewhere.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      // A dialog open over the page keeps its keys.
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, inputRef]);

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              // Esc empties the field; an empty field leaves Esc to the page.
              if (e.key === 'Escape' && query) {
                e.preventDefault();
                e.stopPropagation();
                onQuery('');
              }
            }}
            placeholder="Filtra le fonti… ( / )"
            aria-label="Filtra le fonti della pratica"
            aria-keyshortcuts="/"
            className={cn(FIELD, 'pl-9 pr-11')}
          />
          {query && (
            <button type="button" onClick={() => { onQuery(''); inputRef.current?.focus(); }} aria-label="Svuota il filtro" className={cn(ICON_BUTTON, 'absolute right-0 top-1/2 -translate-y-1/2')}>
              <X size={16} aria-hidden />
            </button>
          )}
        </div>
        <button
          ref={toggleRef}
          type="button"
          onClick={() => { setMoving(false); onSelecting(!selecting); }}
          aria-expanded={selecting}
          className={cn(HEADER_BUTTON, 'justify-center whitespace-nowrap')}
        >
          <CheckSquare size={16} aria-hidden />
          {selecting ? 'Fine' : 'Seleziona'}
        </button>
      </div>
      {/* Said to a screen reader as it changes: how many rows the filter leaves. */}
      <p role="status" className={cn('text-sm text-slate-600 dark:text-slate-400', !filtering && 'sr-only')}>
        {filtering ? `${shown} di ${total}` : ''}
      </p>
      <Expand open={selecting} onClose={() => onSelecting(false)} initialFocusRef={toggleRef}>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
          <span role="status" className="mr-auto px-1 text-sm text-slate-700 dark:text-slate-300">
            {selectedCount === 1 ? '1 selezionato' : `${selectedCount} selezionati`}
          </span>
          <button
            type="button"
            onClick={() => setMoving((v) => !v)}
            disabled={selectedCount === 0}
            aria-expanded={moving}
            className={cn(HEADER_BUTTON, 'justify-center whitespace-nowrap disabled:opacity-40')}
          >
            <FolderInput size={16} aria-hidden />
            Sposta in…
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={selectedCount === 0}
            className={cn(HEADER_BUTTON, 'justify-center whitespace-nowrap text-red-700 disabled:opacity-40 dark:text-red-300')}
          >
            <FolderMinus size={16} aria-hidden />
            Togli dalla pratica
          </button>
        </div>
        <Expand open={selecting && moving} onClose={() => setMoving(false)}>
          <RowMovePicker from={dossierId} onMove={onMove} onDone={() => setMoving(false)} />
        </Expand>
      </Expand>
    </div>
  );
}
