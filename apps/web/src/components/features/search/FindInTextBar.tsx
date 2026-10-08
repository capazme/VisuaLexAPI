import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { FOCUS_RING } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';
import type { FindInText } from '../../../hooks/useFindInText';

export interface FindInTextBarProps {
    query: string;
    onQueryChange: (query: string) => void;
    /** What `useFindInText` returned for this query. */
    find: FindInText;
    onClose: () => void;
    /** Where focus goes on close: the toolbar's toggle button. Without it, the element focused when the bar opened. */
    returnFocusRef?: RefObject<HTMLElement | null>;
}

const ICON_BUTTON =
    'inline-flex items-center justify-center min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 md:p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors ' + FOCUS_RING;

function counterText({ count, index, truncated, searched }: FindInText): string {
    if (truncated) return 'oltre 1000: affina la ricerca';
    if (!searched) return '';
    if (count === 0) return 'Nessun risultato';
    return `${index + 1} di ${count}`;
}

/**
 * The find box under a reading toolbar. Presentational over `useFindInText`: it
 * takes focus when it opens and gives it back when it closes: to
 * `returnFocusRef`, or else to what held focus when it opened (never the field itself).
 */
export function FindInTextBar({ query, onQueryChange, find, onClose, returnFocusRef }: FindInTextBarProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const openerRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        // Recorded once: StrictMode runs this twice and the second time the field already has focus.
        if (openerRef.current === null) {
            const active = document.activeElement;
            if (active instanceof HTMLElement && active !== inputRef.current && active !== document.body) {
                openerRef.current = active;
            }
        }
        inputRef.current?.focus();
    }, []);

    const close = () => {
        onClose();
        const opener = returnFocusRef?.current ?? openerRef.current;
        if (opener?.isConnected) opener.focus();
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) find.previous();
            else find.next();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    };

    return (
        <div
            role="search"
            className={cn(
                'flex w-full items-center gap-1 px-2 py-1 border-b border-slate-200 dark:border-slate-700',
                'bg-white dark:bg-slate-900',
            )}
        >
            <input
                ref={inputRef}
                type="text"
                role="searchbox"
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={onKeyDown}
                aria-label="Cerca nel testo"
                placeholder="Cerca nel testo"
                autoComplete="off"
                spellCheck={false}
                className={cn(
                    'min-h-[44px] md:min-h-0 min-w-0 flex-1 rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm text-slate-800 dark:border-slate-600 dark:text-slate-100',
                    FOCUS_RING,
                )}
            />
            <span role="status" aria-live="polite" className="whitespace-nowrap px-1 text-xs text-slate-500 dark:text-slate-400">
                {counterText(find)}
            </span>
            <button type="button" onClick={find.previous} aria-label="Risultato precedente" title="Risultato precedente" className={ICON_BUTTON}>
                <ChevronUp size={16} aria-hidden />
            </button>
            <button type="button" onClick={find.next} aria-label="Risultato successivo" title="Risultato successivo" className={ICON_BUTTON}>
                <ChevronDown size={16} aria-hidden />
            </button>
            <button type="button" onClick={close} aria-label="Chiudi la ricerca" title="Chiudi la ricerca" className={ICON_BUTTON}>
                <X size={16} aria-hidden />
            </button>
        </div>
    );
}
