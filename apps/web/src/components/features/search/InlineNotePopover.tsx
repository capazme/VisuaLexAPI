import { useState } from 'react';
import {
    useFloating,
    useDismiss,
    useRole,
    useInteractions,
    FloatingPortal,
    FloatingFocusManager,
    autoUpdate,
    flip,
    offset,
    shift,
    arrow,
} from '@floating-ui/react';
import { useRef } from 'react';
import { StickyNote, Trash2 } from 'lucide-react';
import type { Annotation } from '../../../types';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { AttributionChip } from '../bulletin/AttributionChip';

export interface InlineNotePopoverProps {
    note: Annotation;
    anchorEl: HTMLElement | null;
    onClose: () => void;
    onUpdate: (id: string, newText: string) => void;
    onRemove: (id: string) => void;
}

/**
 * Compact popover shown when the user clicks an inline `.note-anchor`
 * wavy underline in the article body. Presents only the single note
 * tied to that anchor, with inline edit + delete — for quick consult
 * without opening the full Peek panel.
 */
export function InlineNotePopover({ note, anchorEl, onClose, onUpdate, onRemove }: InlineNotePopoverProps) {
    const arrowRef = useRef<HTMLDivElement>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState(note.text);

    // Pass the anchor straight to useFloating via `elements.reference` so the
    // first render already has a valid position. Using `setReference` in a
    // useLayoutEffect instead leaves the FIRST frame with a null reference, so
    // the floating div renders at document (0,0) — i.e. the very top of the
    // page. On a long, scrolled article that position is above the viewport
    // and the popover appears to "not exist".
    const { refs, floatingStyles, context, placement, middlewareData } = useFloating({
        open: true,
        onOpenChange: (open) => { if (!open) onClose(); },
        placement: 'top',
        elements: { reference: anchorEl },
        middleware: [
            offset(10),
            flip({ fallbackPlacements: ['bottom', 'top-start', 'bottom-start'] }),
            shift({ padding: 12 }),
            // eslint-disable-next-line react-hooks/refs -- floating-ui middleware accepts a ref object as its standard API
            arrow({ element: arrowRef }),
        ],
        whileElementsMounted: autoUpdate,
    });

    const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true });
    const role = useRole(context, { role: 'dialog' });
    const { getFloatingProps } = useInteractions([dismiss, role]);

    const startEdit = () => {
        setDraft(note.text);
        setIsEditing(true);
    };
    const commitEdit = () => {
        const trimmed = draft.trim();
        if (trimmed && trimmed !== note.text) {
            onUpdate(note.id, trimmed);
        }
        setIsEditing(false);
    };
    const cancelEdit = () => {
        setDraft(note.text);
        setIsEditing(false);
    };

    const arrowX = middlewareData.arrow?.x;
    const arrowY = middlewareData.arrow?.y;
    const sideMap = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' } as const;
    const primary = placement.split('-')[0] as keyof typeof sideMap;
    const staticSide: 'top' | 'right' | 'bottom' | 'left' = sideMap[primary] ?? 'bottom';

    // Grow the scale-in animation from the arrow tip (the edge facing the
    // anchor) so the popover doesn't look like it falls from above.
    const [placementSide, placementAlign] = placement.split('-');
    const originMain = sideMap[placementSide as keyof typeof sideMap] ?? 'center';
    const originCrossHoriz = placementSide === 'top' || placementSide === 'bottom';
    const originCross = !placementAlign
        ? (originCrossHoriz && arrowX != null ? `${arrowX}px` : originCrossHoriz && arrowY != null ? 'center' : 'center')
        : originCrossHoriz
            ? (placementAlign === 'start' ? 'left' : 'right')
            : (placementAlign === 'start' ? 'top' : 'bottom');
    const transformOrigin = originCrossHoriz ? `${originCross} ${originMain}` : `${originMain} ${originCross}`;

    return (
        <FloatingPortal>
            <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className={Z_INDEX.citationPreview}
                >
                    {/* Inner wrapper hosts the enter animation so its
                        scale transform doesn't fight floating-ui's
                        positioning transform on the outer element. */}
                    <div
                        style={{ transformOrigin }}
                        className={cn(
                            'relative w-[300px] rounded-lg shadow-xl border border-amber-200 dark:border-amber-900/40',
                            'bg-white dark:bg-slate-900 animate-in fade-in zoom-in-95 duration-150',
                        )}
                    >
                        <div
                            ref={arrowRef}
                            style={{
                                left: arrowX != null ? `${arrowX}px` : '',
                                top: arrowY != null ? `${arrowY}px` : '',
                                [staticSide]: '-5px',
                            }}
                            className="absolute w-2.5 h-2.5 rotate-45 bg-white dark:bg-slate-900 border-r border-b border-amber-200 dark:border-amber-900/40"
                        />

                        <div className="px-3 py-2.5 flex items-start gap-2">
                        <StickyNote size={14} className="text-amber-500 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            {note.anchorText && (
                                <div className="text-[11px] italic text-amber-700 dark:text-amber-400 mb-1.5 line-clamp-2">
                                    &ldquo;{note.anchorText}&rdquo;
                                </div>
                            )}
                            {isEditing ? (
                                <textarea
                                    autoFocus
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    onBlur={commitEdit}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit(); }
                                    }}
                                    rows={Math.max(2, draft.split('\n').length)}
                                    className="w-full resize-none rounded-md border border-amber-500/50 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                                />
                            ) : (
                                <>
                                    <button
                                        onClick={startEdit}
                                        className="w-full text-left whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 rounded"
                                        title="Clicca per modificare"
                                    >
                                        {note.text}
                                    </button>
                                    {note.sourceSuggestionId && (
                                        <div className="mt-1">
                                            <AttributionChip author={note.originalAuthor} />
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                        <button
                            onClick={() => { onRemove(note.id); onClose(); }}
                            className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
                            title="Elimina nota"
                            aria-label="Elimina nota"
                        >
                            <Trash2 size={12} />
                        </button>
                        </div>
                    </div>
                </div>
            </FloatingFocusManager>
        </FloatingPortal>
    );
}
