import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { MoveHorizontal } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { getSelectionAnchor, rangeFromPlainOffsets } from '../../../utils/selectionOffset';
import { scrollToMiddle } from '../../../utils/scrollParent';

/** The server's bounds for a passage's words (D7b contract §2.3). */
export const MOVE_MIN = 1;
export const MOVE_MAX = 2000;

type Edge = 'start' | 'end';

export interface MoveProposalBarProps {
    /** The reader's text root: the selection is read there, as a highlight of the user's is (`getSelectionAnchor`). */
    textRootRef: RefObject<HTMLElement | null>;
    /** Where the passage is now, in the reader's projection. */
    startOffset: number;
    text: string;
    /** The new boundaries: the offset in the same projection, and the projection's own slice there (root rule 23). */
    onSave: (startOffset: number, text: string) => void;
    onCancel: () => void;
}

/**
 * «Sposta l'evidenziazione» (D7b): the passage's words selected in the text, the user selects new ones (a drag, a touch,
 * or Maiusc+frecce from the keyboard, a word at a time with Ctrl or Alt), and «Sposta qui» saves them. The selection is
 * read as a highlight of the user's is, so the offset is in the renderer's projection and no character of the text
 * changes; the note keeps its state. «Sposta l'inizio» / «Sposta la fine» say which edge the keys move. Enter saves, Esc
 * leaves. The selection popup is off meanwhile (the reader passes `selectionPopup={false}` to `ArticleBody`).
 */
export function MoveProposalBar({ textRootRef, startOffset, text, onSave, onCancel }: MoveProposalBarProps) {
    const barRef = useRef<HTMLDivElement>(null);
    const [edge, setEdge] = useState<Edge>('end');
    const [current, setCurrent] = useState<{ startOffset: number; text: string } | null>(null);
    const [outside, setOutside] = useState(false);

    // The passage's words selected, the end as the moving edge, and the focus on the bar: the keys move the selection.
    useLayoutEffect(() => {
        const root = textRootRef.current;
        const range = root ? rangeFromPlainOffsets(root, startOffset, startOffset + text.length) : null;
        const selection = window.getSelection();
        if (range && selection) {
            selection.removeAllRanges();
            selection.addRange(range);
            const mark = range.startContainer.parentElement;
            if (mark) scrollToMiddle(mark);
        }
        barRef.current?.focus({ preventScroll: true });
        // Only on opening: the words are the user's to change from here.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // What is selected now, read as a highlight of the user's is.
    useEffect(() => {
        const read = () => {
            const root = textRootRef.current;
            const selection = window.getSelection();
            if (!root || !selection || selection.isCollapsed) {
                setCurrent(null);
                setOutside(false);
                return;
            }
            const anchor = getSelectionAnchor(root, selection);
            setCurrent(anchor);
            setOutside(!anchor);
        };
        read();
        document.addEventListener('selectionchange', read);
        return () => document.removeEventListener('selectionchange', read);
    }, [textRootRef]);

    const valid = current !== null && current.text.length >= MOVE_MIN && current.text.length <= MOVE_MAX;
    const unchanged = current !== null && current.startOffset === startOffset && current.text === text;
    const canSave = valid && !unchanged;

    const save = useCallback(() => {
        if (!canSave || !current) return;
        window.getSelection()?.removeAllRanges();
        onSave(current.startOffset, current.text);
    }, [canSave, current, onSave]);

    const cancel = useCallback(() => {
        window.getSelection()?.removeAllRanges();
        onCancel();
    }, [onCancel]);

    /** Which edge the keys move: the selection's focus goes to that edge. */
    const chooseEdge = (next: Edge) => {
        setEdge(next);
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
        const range = selection.getRangeAt(0);
        if (next === 'start') selection.setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset);
        else selection.setBaseAndExtent(range.startContainer, range.startOffset, range.endContainer, range.endOffset);
    };

    // Maiusc+frecce move the chosen edge wherever the focus is (the bar, the page); Enter saves, Esc leaves.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
                return;
            }
            const onControl = e.target instanceof HTMLElement && e.target.closest('button, input, textarea, select');
            if (e.key === 'Enter' && !onControl) {
                e.preventDefault();
                save();
                return;
            }
            if (!e.shiftKey) return;
            const directions: Record<string, ['backward' | 'forward', 'character' | 'line']> = {
                ArrowLeft: ['backward', 'character'],
                ArrowRight: ['forward', 'character'],
                ArrowUp: ['backward', 'line'],
                ArrowDown: ['forward', 'line'],
            };
            const step = directions[e.key];
            const selection = window.getSelection() as (Selection & { modify?: (a: string, d: string, g: string) => void }) | null;
            if (!step || !selection?.modify || selection.rangeCount === 0) return;
            e.preventDefault();
            const granularity = step[1] === 'character' && (e.ctrlKey || e.altKey) ? 'word' : step[1];
            selection.modify('extend', step[0], granularity);
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [cancel, save]);

    const help = outside
        ? 'Seleziona le parole nel testo di questa voce.'
        : current && current.text.length > MOVE_MAX
            ? `Al massimo ${MOVE_MAX} caratteri.`
            : null;

    return (
        <div
            ref={barRef}
            tabIndex={-1}
            role="group"
            aria-label="Sposta l'evidenziazione"
            className={cn(
                'fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-lg focus:outline-none md:inset-x-auto md:bottom-4 md:left-1/2 md:w-[min(36rem,calc(100vw-2rem))] md:-translate-x-1/2 md:rounded-xl md:border dark:border-slate-700 dark:bg-slate-900',
                Z_INDEX.floating,
            )}
        >
            <p className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                <MoveHorizontal size={16} aria-hidden className="shrink-0 text-primary-600 dark:text-primary-400" />
                Seleziona le nuove parole del passaggio
            </p>
            {/* The keys and the edges are a keyboard's: on a touch screen the system's own handles move the selection. */}
            <p className="mt-0.5 text-xs text-slate-600 [@media(pointer:coarse)]:hidden dark:text-slate-400">
                Trascina sul testo, oppure Maiusc+frecce (con Ctrl, una parola alla volta). Invio sposta, Esc annulla.
            </p>
            <p aria-live="polite" className="mt-2 line-clamp-2 text-sm text-slate-800 [overflow-wrap:anywhere] dark:text-slate-200">
                {help ?? (current ? <>&ldquo;{current.text}&rdquo;</> : 'Nessuna parola selezionata.')}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
                <div role="group" aria-label="Il bordo che si sposta" className="flex gap-1 [@media(pointer:coarse)]:hidden">
                    {(['start', 'end'] as const).map((which) => (
                        <button
                            key={which}
                            type="button"
                            aria-pressed={edge === which}
                            onClick={() => chooseEdge(which)}
                            className={cn(
                                'min-h-[44px] rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 motion-reduce:transition-none md:min-h-9',
                                edge === which
                                    ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300'
                                    : 'border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
                            )}
                        >
                            {which === 'start' ? "Sposta l'inizio" : 'Sposta la fine'}
                        </button>
                    ))}
                </div>
                <div className="ml-auto flex gap-2">
                    <button
                        type="button"
                        onClick={cancel}
                        className="min-h-[44px] rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-9 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                        Annulla
                    </button>
                    <button
                        type="button"
                        onClick={save}
                        disabled={!canSave}
                        className="min-h-[44px] rounded-lg bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-9"
                    >
                        Sposta qui
                    </button>
                </div>
            </div>
        </div>
    );
}
