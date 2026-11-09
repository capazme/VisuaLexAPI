import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import type { Annotation, Proposal } from '../../../types';
import { cn } from '../../../lib/utils';
import { glossAnchor } from '../../../utils/aiReview';
import { resolveAnchors, resolveGlosses, type LocatedThread } from '../../../utils/articleAnnotations';
import { rangeFromPlainOffsets } from '../../../utils/selectionOffset';
import { placeGlossCards } from '../../../utils/glossLayout';
import { clearGlossPassage, showGlossPassage } from '../../../utils/glossPassage';
import { scrollToMiddle } from '../../../utils/scrollParent';
import type { ProposalActions } from './BlockAnnotationsSheet';
import { GlossCard } from './GlossCard';
import { NoteDraftCard, NoteMarginCard, ThreadCard } from './MarginCards';
import { NoteComposerSheet } from './NoteComposerSheet';

/** The room the column needs beside a text still readable (about 32rem of text, the 17.5rem column, the gap). */
export const MARGIN_MIN_REM = 52;

export interface AnnotationMarginHandle {
    /**
     * Focuses the first card, in the order of the text, among `keys` (`note:<id>`, `gloss:<id>`, `thread:<id>`), when
     * the column is shown: false otherwise (the caller opens the block's sheet instead).
     */
    focus: (keys: readonly string[]) => boolean;
}

/** A new note being written: its words, where they start. */
export interface NoteDraft {
    text: string;
    startOffset: number;
}

export interface AnnotationMarginProps {
    /** The projection the anchors count in (an article's text without `\n`, a decision's `decisionProjection`). */
    plain: string;
    /** The reader's text root: a passage's height is read from its words there. */
    textRootRef: RefObject<HTMLElement | null>;
    /** The HTML on screen: a redraw moves the words, the cards follow. */
    contentKey: string;
    /** The reader's own notes on this text: those anchored on words that land are cards. */
    notes?: readonly Annotation[];
    onUpdateNote?: (id: string, text: string) => void;
    onRemoveNote?: (id: string) => void;
    /** A new note's editor: a card at its words where the column has room, else a sheet from the bottom. */
    draft?: NoteDraft | null;
    onSaveDraft?: (text: string) => void;
    onCancelDraft?: () => void;
    /** The passage discussions that land in the text: a card each, which opens it in its panel. */
    threads?: readonly LocatedThread[];
    onOpenThread?: (id: string) => void;
    /** Fingerprint of the text on screen, to tell a discussion opened on another text. */
    textHash?: string | null;
    /** An application's glosses on a dossier entry (D8), with what the user does with them. */
    glosses?: readonly Proposal[];
    glossActions?: ProposalActions;
    /** The gloss whose words are shown (`useGlossPassage`), and the card that says so. */
    shownGlossId?: string | null;
    onShowGlossPassage?: (id: string, show: boolean) => void;
    /**
     * Whether the column is shown — the reader has the room and something to put in it: the block's sign then focuses
     * a card instead of opening its sheet.
     */
    onWideChange?: (wide: boolean) => void;
    /** Whether the reader has room for the column at all, cards or not (Study Mode writes a note elsewhere without). */
    onRoomChange?: (roomy: boolean) => void;
    /** Classes for the wrapper (Study Mode keeps the column off the scroller's edge). */
    className?: string;
    /** The text (`ArticleBody`): always the first child, so adding or removing cards never mounts it again. */
    children: ReactNode;
    ref?: Ref<AnnotationMarginHandle>;
}

/** A card of the column: what it is and where its words are. */
type Entry = { key: string; start: number; end: number } & (
    | { kind: 'note'; note: Annotation }
    | { kind: 'thread'; thread: LocatedThread['thread'] }
    | { kind: 'gloss'; gloss: Proposal }
    | { kind: 'draft'; draft: NoteDraft }
);

/**
 * The sign of the block holding these words, found again from the offsets: every redraw of the text (a removal, a state
 * changed) replaces the signs, so one found before it is no longer in the page.
 */
function signAt(root: HTMLElement | null, start: number, end: number): HTMLElement | null {
    if (!root) return null;
    return rangeFromPlainOffsets(root, start, end)?.startContainer.parentElement
        ?.closest('.vlx-b, .vlx-dec-para')?.querySelector<HTMLElement>(':scope > .vlx-sign') ?? null;
}

/** The root's font size in px: the column's room is counted in rem, as the text's measure. */
const remPx = () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/**
 * What the reader wrote and was told beside the text (A4 §6, after D8's glosses), as a word processor's comments: the
 * text keeps the left, a column of cards on the right — the reader's own notes, the passage discussions with
 * colleagues, an application's glosses, and the editor of a new note — each at the height of its passage (the top of
 * the first line of its words in the text root, read from a DOM range, so no element is added to the text, root rule
 * 23), pushed down under the one above when they would overlap, in the order of the text (`placeGlossCards`). The
 * column is drawn where the reader has room for it (`MARGIN_MIN_REM`, measured on the wrapper) and something to put in
 * it; with less room it is not, and a new note's editor is a sheet from the bottom (`NoteComposerSheet`), the cards
 * the block's sheet's. The cards follow the text as it redraws or reflows, and each other as one grows (an edit): a
 * `ResizeObserver` on the text root, the wrapper and every card. A card hovered or focused shows its words in the text
 * (the CSS Custom Highlight API, `utils/glossPassage.ts`).
 */
export function AnnotationMargin({
    plain, textRootRef, contentKey, notes = [], onUpdateNote, onRemoveNote, draft = null, onSaveDraft, onCancelDraft,
    threads = [], onOpenThread, textHash, glosses = [], glossActions, shownGlossId = null, onShowGlossPassage,
    onWideChange, onRoomChange, className, children, ref,
}: AnnotationMarginProps) {
    const owner = useId();
    const wrapperRef = useRef<HTMLDivElement>(null);
    const columnRef = useRef<HTMLElement>(null);
    const cards = useRef(new Map<string, HTMLElement>());

    // Whether the reader has room for the column, known before any card is there (a new note's editor goes by it).
    const [roomy, setRoomy] = useState(false);
    useLayoutEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;
        const check = () => setRoomy(wrapper.getBoundingClientRect().width >= MARGIN_MIN_REM * remPx());
        check();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(check);
        observer.observe(wrapper);
        return () => observer.disconnect();
    }, []);

    const entries = useMemo<Entry[]>(() => {
        const out: Entry[] = [];
        if (onUpdateNote && onRemoveNote) {
            const anchored = notes.filter((n) => n.anchorText && typeof n.startOffset === 'number');
            for (const anchor of resolveAnchors(plain, [], anchored)) {
                if (anchor.kind === 'note') out.push({ key: `note:${anchor.note.id}`, start: anchor.start, end: anchor.end, kind: 'note', note: anchor.note });
            }
        }
        if (onOpenThread) {
            for (const { thread, start, end } of threads) out.push({ key: `thread:${thread.id}`, start, end, kind: 'thread', thread });
        }
        if (glossActions) {
            const byId = new Map(glosses.map((g) => [g.id, g]));
            for (const anchor of resolveGlosses(plain, glosses.map(glossAnchor))) {
                const gloss = anchor.kind === 'gloss' ? byId.get(anchor.gloss.id) : undefined;
                if (gloss) out.push({ key: `gloss:${gloss.id}`, start: anchor.start, end: anchor.end, kind: 'gloss', gloss });
            }
        }
        if (draft && onSaveDraft && onCancelDraft) {
            out.push({ key: 'draft', start: draft.startOffset, end: draft.startOffset + draft.text.length, kind: 'draft', draft });
        }
        return out.sort((x, y) => x.start - y.start || x.end - y.end);
    }, [plain, notes, onUpdateNote, onRemoveNote, threads, onOpenThread, glosses, glossActions, draft, onSaveDraft, onCancelDraft]);

    const active = roomy && entries.length > 0;
    const [layout, setLayout] = useState<{ tops: Record<string, number>; height: number } | null>(null);

    const measure = useCallback(() => {
        const column = columnRef.current;
        const root = textRootRef.current;
        if (!column || !root) return;
        const origin = column.getBoundingClientRect().top;
        let previous = 0;
        const slots = entries.map((entry) => {
            const range = rangeFromPlainOffsets(root, entry.start, entry.end);
            const rect = range?.getClientRects?.()[0];
            // Words with no box (the update notes folded away): under the card before it, never at the column's top.
            const want = rect ? rect.top - origin : previous;
            previous = want;
            return { id: entry.key, want, height: cards.current.get(entry.key)?.offsetHeight ?? 0 };
        });
        const next = placeGlossCards(slots);
        setLayout((prev) => (prev && prev.height === next.height && slots.every((s) => prev.tops[s.id] === next.tops[s.id]) ? prev : next));
    }, [entries, textRootRef]);

    // Measured in a frame, after the browser laid the text out (and not as a state set inside the effect).
    const frame = useRef(0);
    const schedule = useCallback(() => {
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(measure);
    }, [measure]);
    useLayoutEffect(() => {
        if (!active) return;
        schedule();
        return () => cancelAnimationFrame(frame.current);
    }, [active, schedule, contentKey]);

    useEffect(() => {
        if (!active || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(schedule);
        if (wrapperRef.current) observer.observe(wrapperRef.current);
        if (textRootRef.current) observer.observe(textRootRef.current);
        for (const card of cards.current.values()) observer.observe(card);
        return () => observer.disconnect();
    }, [active, schedule, textRootRef, entries, contentKey]);

    // The cards placed once take their moves smoothly; a card's first place is taken at once (it would slide down from
    // the column's top). Marked a frame after it was drawn there.
    const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());
    useEffect(() => {
        if (!layout) return;
        const placed = Object.keys(layout.tops);
        if (placed.every((id) => settled.has(id))) return;
        const handle = requestAnimationFrame(() => setSettled(new Set(placed)));
        return () => cancelAnimationFrame(handle);
    }, [layout, settled]);

    const reportWide = useRef(onWideChange);
    const reportRoom = useRef(onRoomChange);
    useEffect(() => { reportWide.current = onWideChange; reportRoom.current = onRoomChange; });
    // Shown once the cards are placed: before that a sign's press would focus a card not yet drawn.
    const shown = active && layout !== null;
    useEffect(() => { reportWide.current?.(shown); }, [shown]);
    useEffect(() => { reportRoom.current?.(roomy); }, [roomy]);

    const focusCard = useCallback((key: string): boolean => {
        const card = cards.current.get(key);
        if (!card) return false;
        card.focus({ preventScroll: true });
        if (document.activeElement !== card) return false;
        scrollToMiddle(card);
        return true;
    }, []);

    useImperativeHandle(ref, () => ({
        focus: (keys) => {
            if (!shown) return false;
            const first = entries.find((e) => keys.includes(e.key));
            return !!first && focusCard(first.key);
        },
    }), [shown, entries, focusCard]);

    // The words of the card hovered or focused (a note's, a discussion's), painted in the text; a gloss shows its own.
    const [passageOf, setPassageOf] = useState<string | null>(null);
    useEffect(() => {
        // A gloss's card shows its words itself (`onShowGlossPassage`).
        const entry = passageOf ? entries.find((e) => e.key === passageOf && e.kind !== 'gloss') : undefined;
        const root = textRootRef.current;
        const range = entry && root ? rangeFromPlainOffsets(root, entry.start, entry.end) : null;
        if (range) showGlossPassage(owner, range);
        else clearGlossPassage(owner);
    }, [owner, passageOf, entries, textRootRef, contentKey]);
    useEffect(() => () => clearGlossPassage(owner), [owner]);

    /**
     * A card removed from the column: it goes at once, and the focus with it would fall to the page — so it goes to the
     * next card, else the one before, else the block's sign of the words it was on — found again once the text has been
     * redrawn without it (`signAt`); a block left with nothing has no sign, and the focus goes to the nearest sign after
     * it, else before it.
     */
    const removed = (key: string) => {
        const index = entries.findIndex((e) => e.key === key);
        const neighbour = entries[index + 1]?.key ?? entries[index - 1]?.key ?? null;
        const entry = entries[index];
        requestAnimationFrame(() => {
            if (neighbour && focusCard(neighbour)) return;
            const root = textRootRef.current;
            if (!entry || !root) return;
            const sign = signAt(root, entry.start, entry.end);
            if (sign) return sign.focus({ preventScroll: true });
            const block = rangeFromPlainOffsets(root, entry.start, entry.end)?.startContainer.parentElement?.closest('.vlx-b, .vlx-dec-para');
            const signs = [...root.querySelectorAll<HTMLElement>('.vlx-sign')];
            const after = block ? signs.find((s) => block.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) : undefined;
            (after ?? signs.at(-1))?.focus({ preventScroll: true });
        });
    };
    /** A card's element, kept by its key: measured, observed and focused. */
    const keepCard = (key: string, el: HTMLElement | null) => {
        if (el) cards.current.set(key, el);
        else cards.current.delete(key);
    };
    /** Esc on a card: back to its block's sign, the way it came (the sign focuses the card). */
    const escapeFrom = (entry: Entry) => signAt(textRootRef.current, entry.start, entry.end)?.focus({ preventScroll: true });

    return (
        <div ref={wrapperRef} data-annotation-margin="" className={cn(active && 'vlx-glossed', className)}>
            <div className="vlx-glossed-grid">
                <div className="min-w-0">{children}</div>
                {active && (
                    <aside
                        ref={columnRef}
                        aria-label="A margine del testo"
                        className="vlx-gloss-column"
                        style={layout ? { height: layout.height } : undefined}
                    >
                        {entries.map((entry) => {
                            const top = layout?.tops[entry.key];
                            return (
                                <div
                                    key={entry.key}
                                    // Transparent, not hidden, until placed: a hidden card would refuse a focus given meanwhile.
                                    className={cn('vlx-gloss-card', top === undefined && 'pointer-events-none opacity-0', !settled.has(entry.key) && 'vlx-gloss-card-fresh')}
                                    style={top === undefined ? undefined : { transform: `translateY(${top}px)` }}
                                    onMouseEnter={() => setPassageOf(entry.key)}
                                    onMouseLeave={() => setPassageOf((k) => (k === entry.key ? null : k))}
                                    onFocus={() => setPassageOf(entry.key)}
                                    onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPassageOf((k) => (k === entry.key ? null : k)); }}
                                >
                                    {entry.kind === 'note' && onUpdateNote && onRemoveNote && (
                                        <NoteMarginCard
                                            ref={(el: HTMLElement | null) => keepCard(entry.key, el)}
                                            note={entry.note}
                                            onUpdate={onUpdateNote}
                                            onRemove={() => { onRemoveNote(entry.note.id); removed(entry.key); }}
                                            onEscape={() => escapeFrom(entry)}
                                        />
                                    )}
                                    {entry.kind === 'thread' && onOpenThread && (
                                        <ThreadCard
                                            ref={(el: HTMLElement | null) => keepCard(entry.key, el)}
                                            thread={entry.thread}
                                            currentTextHash={textHash}
                                            onOpen={() => onOpenThread(entry.thread.id)}
                                            onEscape={() => escapeFrom(entry)}
                                        />
                                    )}
                                    {entry.kind === 'gloss' && glossActions && (
                                        <GlossCard
                                            ref={(el: HTMLElement | null) => keepCard(entry.key, el)}
                                            gloss={entry.gloss}
                                            actions={glossActions}
                                            active={shownGlossId === entry.gloss.id}
                                            onShowPassage={(show) => onShowGlossPassage?.(entry.gloss.id, show)}
                                            onRemove={() => { glossActions.remove(entry.gloss.id); removed(entry.key); }}
                                            onEscape={() => escapeFrom(entry)}
                                        />
                                    )}
                                    {entry.kind === 'draft' && onSaveDraft && onCancelDraft && (
                                        <NoteDraftCard
                                            ref={(el: HTMLElement | null) => keepCard(entry.key, el)}
                                            text={entry.draft.text}
                                            onSave={onSaveDraft}
                                            onCancel={onCancelDraft}
                                            placed={top !== undefined}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </aside>
                )}
            </div>
            {draft && onSaveDraft && onCancelDraft && !roomy && (
                <NoteComposerSheet text={draft.text} onSave={onSaveDraft} onCancel={onCancelDraft} />
            )}
        </div>
    );
}
