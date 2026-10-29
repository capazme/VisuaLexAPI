import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { MoveHorizontal } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { getSelectionAnchor, rangeFromPlainOffsets } from '../../../utils/selectionOffset';
import { scrollToMiddle } from '../../../utils/scrollParent';
import { isEditableTarget } from '../../ui/notifications/undoShortcut';
import { isWorkspaceCovered } from '../../../utils/findWindowControl';
import { useMediaQuery } from '../../../hooks/useIsDesktop';
import { setFootBarRoom } from '../../ui/notifications/footBar';

/** The server's bounds for a passage's words (D7b contract §2.3). */
export const MOVE_MIN = 1;
export const MOVE_MAX = 2000;
/** What the live region reads of the words selected: enough to know where they are, not two thousand characters. */
const SAID_MAX = 80;
/** The keys in the text that open something (a sign, a reference, the update notes' toggle): theirs again once it closes. */
const TEXT_CONTROLS = '.vlx-sign, .vlx-ref, .vlx-updates-toggle';

type Edge = 'start' | 'end';

export interface MoveProposalBarProps {
    /** The reader's text root: the selection is read there, as a highlight of the user's is (`getSelectionAnchor`). */
    textRootRef: RefObject<HTMLElement | null>;
    proposalId: string;
    /** Where the passage is now, in the reader's projection. */
    startOffset: number;
    text: string;
    /** The new boundaries: the offset in the same projection, and the projection's own slice there (root rule 23). */
    onSave: (startOffset: number, text: string) => void;
    onCancel: () => void;
    /** The bar's name: «Sposta l'evidenziazione» for a coloured passage, the gloss's own words for a gloss (D8). */
    label?: string;
    /**
     * Where the focus goes once the bar closes, when the caller has a better place than the block's sign (a gloss's card
     * beside the text, D8): true when it took it.
     */
    focusAfter?: () => boolean;
}

const sameWords = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

/** Whether the selection runs backwards (its moving end, the focus, before its anchor). */
function isBackward(selection: Selection): boolean {
    if (!selection.anchorNode || !selection.focusNode) return false;
    if (selection.anchorNode === selection.focusNode) return selection.focusOffset < selection.anchorOffset;
    return !!(selection.anchorNode.compareDocumentPosition(selection.focusNode) & Node.DOCUMENT_POSITION_PRECEDING);
}

/**
 * «Sposta l'evidenziazione» (D7b): the passage's words selected in the text, the user selects new ones (a drag, a touch,
 * or Maiusc+frecce from the keyboard, a word at a time with Ctrl or Alt), and «Sposta qui» saves them. The selection is
 * read as a highlight of the user's is, so the offset is in the renderer's projection and no character of the text
 * changes; the note keeps its state. «Sposta l'inizio» / «Sposta la fine» say which edge the keys move. Enter saves, Esc
 * leaves — never a key a field, a dialog or another control took. While it is open a click in the text opens nothing
 * (a drag ends with one, on the very passage being moved), and the selection popup is off (`ArticleBody`'s
 * `selectionPopup`). One bar on the page at a time (`assistantProposalsStore.moving`).
 */
export function MoveProposalBar({
    textRootRef, proposalId, startOffset, text, onSave, onCancel, label = "Sposta l'evidenziazione", focusAfter,
}: MoveProposalBarProps) {
    const barRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const helpId = useId();
    // A touch screen with no fine pointer: the system's handles move the selection, so the help says how and the
    // keyboard's bits go (an iPad with a trackpad keeps them).
    const touchOnly = useMediaQuery('(pointer: coarse)');
    const finePointer = useMediaQuery('(any-pointer: fine)');
    const coarse = touchOnly && !finePointer;
    const [edge, setEdge] = useState<Edge>('end');
    const [current, setCurrent] = useState<{ startOffset: number; text: string } | null>(null);
    const [outside, setOutside] = useState(false);
    // What the bar opened on: a save that changes nothing (the same words, read again) is not one.
    const opened = useRef<{ startOffset: number; text: string } | null>(null);
    // A press on the bar, and the words selected before it: iOS empties the selection as the finger lands on a button,
    // before the click reads it, so an emptying meanwhile is not read and the words come back once the press is over.
    // `lastRange` is the selection read last, null once the user emptied it (never put back then).
    const pressing = useRef(false);
    const lastRange = useRef<Range | null>(null);

    // The passage's words selected — only when they are still at their offset —, the end as the moving edge, and the
    // focus on the bar: the keys move the selection.
    useLayoutEffect(() => {
        const root = textRootRef.current;
        const range = root ? rangeFromPlainOffsets(root, startOffset, startOffset + text.length) : null;
        const selection = window.getSelection();
        if (range && selection && sameWords(range.toString(), text)) {
            selection.removeAllRanges();
            selection.addRange(range);
            opened.current = getSelectionAnchor(root, selection);
            const mark = range.startContainer.parentElement;
            if (mark) scrollToMiddle(mark);
        } else {
            selection?.removeAllRanges();
        }
        barRef.current?.focus({ preventScroll: true });
        // Only on opening: the words are the user's to change from here.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // What is selected now, read as a highlight of the user's is; the edge the keys move follows the selection's way.
    useEffect(() => {
        const read = () => {
            const root = textRootRef.current;
            const selection = window.getSelection();
            if (pressing.current && (!selection || selection.isCollapsed)) return;
            if (!root || !selection || selection.isCollapsed) {
                lastRange.current = null;
                setCurrent(null);
                setOutside(false);
                return;
            }
            const anchor = getSelectionAnchor(root, selection);
            setCurrent(anchor);
            setOutside(!anchor);
            lastRange.current = anchor ? selection.getRangeAt(0).cloneRange() : null;
            if (anchor) setEdge(isBackward(selection) ? 'start' : 'end');
        };
        read();
        document.addEventListener('selectionchange', read);
        return () => document.removeEventListener('selectionchange', read);
    }, [textRootRef]);

    // A click in the text opens nothing while the words are chosen: the passage's popover, a key passage, a note. Nor
    // Enter or Space on a sign, a reference or the update notes' toggle: a popover over the bar.
    useEffect(() => {
        const root = textRootRef.current;
        if (!root) return;
        const swallow = (e: MouseEvent) => e.stopPropagation();
        const swallowKey = (e: KeyboardEvent) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (!(e.target instanceof Element) || !e.target.matches(TEXT_CONTROLS)) return;
            e.stopPropagation();
            e.preventDefault(); // Space would scroll the page
        };
        root.addEventListener('click', swallow, true);
        root.addEventListener('keydown', swallowKey, true);
        return () => {
            root.removeEventListener('click', swallow, true);
            root.removeEventListener('keydown', swallowKey, true);
        };
    }, [textRootRef]);

    // A press on the bar lasts until the bar's click has been handled — iOS sends the click, and may empty the selection,
    // well after the finger lifts —, or 400 ms after the release when no click comes; then the words selected as it began
    // are put back if it emptied them and the bar is still there.
    useEffect(() => {
        const bar = barRef.current;
        if (!bar) return;
        let open = true;
        let timer = 0;
        let snapshot: Range | null = null;
        const finish = () => {
            window.clearTimeout(timer);
            pressing.current = false;
            const selection = window.getSelection();
            const words = snapshot;
            snapshot = null;
            if (!open || !selection || !words) return;
            if (selection.rangeCount > 0 && !selection.isCollapsed) return;
            selection.removeAllRanges();
            selection.addRange(words);
        };
        const release = () => {
            window.removeEventListener('pointerup', release);
            window.removeEventListener('pointercancel', release);
            window.clearTimeout(timer);
            timer = window.setTimeout(finish, 400);
        };
        const press = () => {
            window.clearTimeout(timer);
            if (!pressing.current) snapshot = lastRange.current;
            pressing.current = true;
            window.addEventListener('pointerup', release);
            window.addEventListener('pointercancel', release);
        };
        // After the button's own handler (the click reaches React's root after this element): it reads the press's words.
        const clicked = () => {
            if (!pressing.current) return;
            window.clearTimeout(timer);
            timer = window.setTimeout(finish, 0);
        };
        bar.addEventListener('pointerdown', press, true);
        bar.addEventListener('click', clicked, true);
        return () => {
            open = false;
            window.clearTimeout(timer);
            bar.removeEventListener('pointerdown', press, true);
            bar.removeEventListener('click', clicked, true);
            window.removeEventListener('pointerup', release);
            window.removeEventListener('pointercancel', release);
        };
    }, []);

    // Its room at the foot of the window while it is open (`footBarStore`): the notifications rise over it.
    useLayoutEffect(() => {
        const bar = barRef.current;
        if (!bar) return;
        // The layout viewport's height, as the bar's `fixed` is (not `innerHeight`, which a pinch-zoom changes).
        const measure = () => setFootBarRoom(Math.max(0, Math.round(document.documentElement.clientHeight - bar.getBoundingClientRect().top)));
        measure();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
        observer?.observe(bar);
        window.addEventListener('resize', measure);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', measure);
            setFootBarRoom(0);
        };
    }, []);

    const valid = current !== null && current.text.length >= MOVE_MIN && current.text.length <= MOVE_MAX;
    const unchanged = current !== null && (
        (current.startOffset === startOffset && current.text === text)
        || (opened.current !== null && current.startOffset === opened.current.startOffset && current.text === opened.current.text)
    );
    const canSave = valid && !unchanged;

    /**
     * The focus back where the passage is (the bar and the card it came from are gone): the caller's place if it has
     * one, else its block's sign — found by the passage's mark, or for a gloss, which has none (D8), by its words.
     */
    const focusPassage = useCallback((at: { startOffset: number; text: string }) => {
        requestAnimationFrame(() => {
            if (focusAfter?.()) return;
            const root = textRootRef.current;
            const mark = root?.querySelector(`[data-highlight="${CSS.escape(proposalId)}"]`)
                ?? (root ? rangeFromPlainOffsets(root, at.startOffset, at.startOffset + at.text.length)?.startContainer.parentElement : null);
            mark?.closest('.vlx-b, .vlx-dec-para')?.querySelector<HTMLElement>(':scope > .vlx-sign')?.focus({ preventScroll: true });
        });
    }, [textRootRef, proposalId, focusAfter]);

    const save = useCallback(() => {
        if (!canSave || !current) return;
        window.getSelection()?.removeAllRanges();
        onSave(current.startOffset, current.text);
        focusPassage(current);
    }, [canSave, current, onSave, focusPassage]);

    const cancel = useCallback(() => {
        window.getSelection()?.removeAllRanges();
        onCancel();
        focusPassage({ startOffset, text });
    }, [onCancel, focusPassage, startOffset, text]);

    /** Which edge the keys move: the selection's focus goes to that edge. */
    const chooseEdge = (next: Edge) => {
        setEdge(next);
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
        const range = selection.getRangeAt(0);
        if (next === 'start') selection.setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset);
        else selection.setBaseAndExtent(range.startContainer, range.startOffset, range.endContainer, range.endOffset);
    };

    // Maiusc+frecce move the chosen edge, wherever the focus is but in a field; Enter saves, Esc leaves. A key a field,
    // a dialog or another control took first is theirs.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.defaultPrevented || isEditableTarget(e.target) || isWorkspaceCovered()) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
                return;
            }
            if (e.key === 'Enter') {
                const onControl = e.target instanceof Element && e.target.closest('button, a, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])');
                if (onControl || !canSave) return;
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
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [cancel, save, canSave]);

    const help = outside
        ? 'Seleziona le parole nel testo di questa voce.'
        : current && current.text.length > MOVE_MAX
            ? `Al massimo ${MOVE_MAX} caratteri.`
            : null;
    const said = help ?? (current
        ? `Selezionate: ${current.text.length > SAID_MAX ? `${current.text.slice(0, SAID_MAX)}…` : current.text}`
        : 'Nessuna parola selezionata.');

    // In a portal: a transformed ancestor (an act being dragged) would otherwise place a fixed bar against itself.
    return createPortal(
        <div
            ref={barRef}
            tabIndex={-1}
            role="group"
            aria-label={label}
            aria-describedby={`${titleId} ${helpId}`}
            className={cn(
                'fixed inset-x-0 bottom-0 select-none border-t border-slate-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-lg focus:outline-none md:inset-x-auto md:bottom-4 md:left-1/2 md:w-[min(36rem,calc(100vw-2rem))] md:-translate-x-1/2 md:rounded-xl md:border dark:border-slate-700 dark:bg-slate-900',
                Z_INDEX.floating,
            )}
        >
            <p id={titleId} className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                <MoveHorizontal size={16} aria-hidden className="shrink-0 text-primary-600 dark:text-primary-400" />
                Seleziona le nuove parole del passaggio
            </p>
            {/* The keys and the edges are a keyboard's: on a touch screen the system's own handles move the selection. */}
            <p id={helpId} className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                {coarse
                    ? 'Tieni premuto su una parola, poi trascina le maniglie. «Sposta qui» salva.'
                    : 'Trascina sul testo, oppure Maiusc+frecce (con Ctrl o Alt, una parola alla volta). Invio sposta, Esc annulla.'}
            </p>
            <p aria-hidden className="mt-2 line-clamp-2 text-sm text-slate-800 [overflow-wrap:anywhere] dark:text-slate-200">
                {help ?? (current ? <>&ldquo;{current.text}&rdquo;</> : 'Nessuna parola selezionata.')}
            </p>
            <span className="sr-only" aria-live="polite">{said}</span>
            <div className="mt-2 flex flex-wrap items-center gap-2">
                {!coarse && <div role="group" aria-label="Il bordo che si sposta" className="flex gap-1">
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
                </div>}
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
        </div>,
        document.body,
    );
}
