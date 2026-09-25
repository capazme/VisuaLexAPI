import { useCallback, useId, useLayoutEffect, useRef, type RefObject } from 'react';
import {
    FloatingFocusManager,
    FloatingPortal,
    autoUpdate,
    flip,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
    useRole,
} from '@floating-ui/react';
import { LocateFixed, Trash2, X } from 'lucide-react';
import type { Highlight } from '../../../types';
import type { BlockAnnotations } from '../../../utils/articleAnnotations';
import { getHighlightSwatch } from '../../../utils/highlightColors';
import { getTransformOrigin } from '../../../utils/floatingOrigin';
import { signReference } from '../../../utils/blockAnchorRect';
import { revealAnnotation, type AnnotationTarget } from '../../../utils/revealAnnotation';
import { useNoteEditing } from '../../../hooks/useNoteEditing';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { AttributionChip } from '../bulletin/AttributionChip';
import { NoteCard } from './NoteCard';

export interface BlockAnnotationsPopoverProps {
    /** The element holding the article text (ArticleBody's contentRef). */
    containerRef: RefObject<HTMLElement | null>;
    /** The block whose sign opened the popover (its `data-block`). */
    blockIndex: number;
    /** `describeBlock`: the printed enumerator, or the block's opening words. */
    blockLabel: string;
    group: BlockAnnotations;
    /**
     * The HTML currently rendered in the body. An edit or a removal redraws
     * the text, sign included: the popover then measures the new sign.
     */
    contentKey: string;
    onClose: () => void;
    onUpdateNote: (id: string, text: string) => void;
    onRemoveNote: (id: string) => void;
    onRemoveHighlight: (id: string) => void;
}

/**
 * The annotations of one block of an article, opened from its sign in the
 * margin or at the end of the block (round B). Lists the block's notes —
 * edit and delete in place — and its highlights — remove — each with
 * "Vai al passo". Esc and the close button give focus back to the sign; a
 * press outside closes it and leaves focus where the reader pressed.
 */
export function BlockAnnotationsPopover({
    containerRef,
    blockIndex,
    blockLabel,
    group,
    contentKey,
    onClose,
    onUpdateNote,
    onRemoveNote,
    onRemoveHighlight,
}: BlockAnnotationsPopoverProps) {
    const titleId = useId();
    // Where focus goes on close: the sign after Esc, the close button or "Vai
    // al passo"; nowhere after an outside press.
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const editing = useNoteEditing(group.notes, onUpdateNote);

    // The sign is SafeHTML markup, replaced on every redraw of the text:
    // always look it up again rather than hold an element.
    const findSign = useCallback(
        () => containerRef.current?.querySelector<HTMLElement>(`.vlx-sign[data-block="${blockIndex}"]`) ?? null,
        [containerRef, blockIndex],
    );

    const close = useCallback((refocus: boolean) => {
        returnFocusRef.current = refocus ? findSign() : null;
        onClose();
    }, [findSign, onClose]);

    // Placed against the whole block (blockAnchorRect): beside it when the
    // margin has room, else below it, else above it — never over the passage
    // it lists, wherever the container query put the sign.
    const { refs, floatingStyles, context, placement, isPositioned, update } = useFloating({
        open: true,
        onOpenChange: (open, _event, reason) => { if (!open) close(reason === 'escape-key'); },
        placement: 'right-start',
        middleware: [
            offset(8),
            flip({ fallbackPlacements: ['bottom-end', 'top-end'] }),
            shift({ padding: 12, crossAxis: true }),
        ],
        whileElementsMounted: autoUpdate,
    });

    // A virtual reference that finds the live sign on every measurement and
    // keeps its last place while the sign has no box; hidden until positioned
    // (gotcha 13).
    useLayoutEffect(() => {
        refs.setPositionReference(signReference(findSign, containerRef.current ?? undefined));
    }, [findSign, refs, containerRef]);

    // A redraw replaced the sign: measure the new one.
    useLayoutEffect(() => { update(); }, [contentKey, update]);

    const dismiss = useDismiss(context, {
        escapeKey: true,
        // A press on this block's own sign is not "outside": its click toggles
        // the popover shut (useArticleTextInteractions); closing here first
        // would let that click open it again.
        outsidePress: (event) => {
            const sign = findSign();
            return !(sign && event.target instanceof Node && sign.contains(event.target));
        },
    });
    const role = useRole(context, { role: 'dialog' });
    const { getFloatingProps } = useInteractions([dismiss, role]);

    const total = group.notes.length + group.highlights.length;
    const remove = (run: () => void) => {
        run();
        // The block's last annotation takes the sign with it.
        if (total === 1) close(false);
    };
    const goTo = (target: AnnotationTarget) => {
        const sign = findSign();
        const container = containerRef.current;
        close(true);
        if (container) revealAnnotation(container, target, sign?.parentElement);
    };

    return (
        <FloatingPortal>
            <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus={returnFocusRef}>
                {/* Outer element: floating-ui positioning only. */}
                <div
                    // eslint-disable-next-line react-hooks/refs -- floating-ui exposes a stable setter, not a ref.current read
                    ref={refs.setFloating}
                    style={{ ...floatingStyles, visibility: isPositioned ? 'visible' : 'hidden' }}
                    {...getFloatingProps()}
                    aria-labelledby={titleId}
                    className={Z_INDEX.citationPreview}
                >
                    {/* Inner element: the entry animation (gotcha 10). */}
                    <div
                        style={{ transformOrigin: getTransformOrigin(placement) }}
                        className={cn(
                            'flex max-h-[60vh] w-[min(22.5rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border shadow-2xl',
                            'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
                            'animate-in fade-in zoom-in-95 duration-150',
                        )}
                    >
                        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 dark:border-slate-800">
                            <h3 id={titleId} className="min-w-0 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                                <span className="uppercase tracking-wide">Annotazioni</span> · {blockLabel}
                            </h3>
                            <button
                                type="button"
                                onClick={() => close(true)}
                                aria-label="Chiudi annotazioni"
                                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 md:min-w-0 md:p-1 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            >
                                <X size={14} aria-hidden />
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                            {group.notes.length > 0 && (
                                <section className="space-y-2">
                                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Note</h4>
                                    {group.notes.map((note) => (
                                        <NoteCard
                                            key={note.id}
                                            note={note}
                                            isEditing={editing.editingId === note.id}
                                            editingText={editing.editingText}
                                            onStartEdit={() => editing.startEdit(note)}
                                            onChangeEdit={editing.setEditingText}
                                            onCommitEdit={editing.commitEdit}
                                            onCancelEdit={editing.cancelEdit}
                                            onRemove={() => remove(() => onRemoveNote(note.id))}
                                            onGoTo={() => goTo({ kind: 'note', id: note.id })}
                                        />
                                    ))}
                                </section>
                            )}
                            {group.highlights.length > 0 && (
                                <section className="space-y-2">
                                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Evidenziazioni</h4>
                                    {group.highlights.map((highlight) => (
                                        <HighlightCard
                                            key={highlight.id}
                                            highlight={highlight}
                                            onGoTo={() => goTo({ kind: 'highlight', id: highlight.id })}
                                            onRemove={() => remove(() => onRemoveHighlight(highlight.id))}
                                        />
                                    ))}
                                </section>
                            )}
                        </div>
                    </div>
                </div>
            </FloatingFocusManager>
        </FloatingPortal>
    );
}

/** A highlight of the block: its colour as a stripe (UI conventions), its text, and what to do with it. */
function HighlightCard({ highlight, onGoTo, onRemove }: { highlight: Highlight; onGoTo: () => void; onRemove: () => void }) {
    return (
        <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3.5 pr-2.5 text-sm dark:border-slate-700 dark:bg-slate-800/50">
            <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: getHighlightSwatch(highlight.color) }} />
            <p className="line-clamp-3 text-slate-800 dark:text-slate-200">&ldquo;{highlight.text}&rdquo;</p>
            {highlight.sourceSuggestionId && (
                <div className="mt-1">
                    <AttributionChip author={highlight.originalAuthor} />
                </div>
            )}
            <div className="mt-1 flex items-center gap-1">
                <button
                    type="button"
                    onClick={onGoTo}
                    className="inline-flex min-h-[44px] items-center gap-1 rounded px-1 text-xs font-medium text-slate-500 transition-colors hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 md:py-0.5 dark:text-slate-400 dark:hover:text-primary-400"
                >
                    <LocateFixed size={12} aria-hidden /> Vai al passo
                </button>
                <button
                    type="button"
                    onClick={onRemove}
                    className="ml-auto inline-flex min-h-[44px] items-center gap-1 rounded px-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 md:min-h-0 md:py-0.5 dark:text-slate-400 dark:hover:bg-red-900/20"
                >
                    <Trash2 size={12} aria-hidden /> Rimuovi
                </button>
            </div>
        </div>
    );
}
