import { useState, useRef, useMemo, useLayoutEffect } from 'react';
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
    type VirtualElement,
} from '@floating-ui/react';
import { StickyNote, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';

export interface InlineNoteComposerProps {
    /** Plain rect of the text selection this note will be anchored to. Used
     * as a virtual reference for floating-ui so the composer pops up right
     * next to the selected span, not on the toolbar button. */
    anchorRect: { x: number; y: number; width: number; height: number };
    /** The selected text that becomes the note anchor. Displayed above the
     * textarea so the user has context while writing. */
    anchorText: string;
    onSave: (text: string) => void;
    onClose: () => void;
}

/**
 * Tooltip-style composer that appears inline on the selected text when the
 * user picks "Aggiungi nota" from the SelectionPopup. Compact, amber-accented,
 * no list / no footer chrome — it's a focused "write a quick note about THIS
 * span" interaction. For the full list view and free-note composer the user
 * still opens the NotesPeekPanel from the toolbar button.
 */
export function InlineNoteComposer({ anchorRect, anchorText, onSave, onClose }: InlineNoteComposerProps) {
    const [draft, setDraft] = useState('');
    const arrowRef = useRef<HTMLDivElement>(null);

    // Memoized virtual reference: floating-ui runtime reads only
    // getBoundingClientRect. Recreating the object every render would
    // re-trigger position updates needlessly, so tie the memo to the rect.
    const virtualReference = useMemo<VirtualElement>(() => ({
        getBoundingClientRect: () => ({
            x: anchorRect.x,
            y: anchorRect.y,
            width: anchorRect.width,
            height: anchorRect.height,
            top: anchorRect.y,
            left: anchorRect.x,
            right: anchorRect.x + anchorRect.width,
            bottom: anchorRect.y + anchorRect.height,
            toJSON() { return this; },
        } as DOMRect),
    }), [anchorRect.x, anchorRect.y, anchorRect.width, anchorRect.height]);

    const { refs, floatingStyles, context, placement, middlewareData, isPositioned } = useFloating({
        open: true,
        onOpenChange: (open) => { if (!open) onClose(); },
        placement: 'top',
        middleware: [
            offset(10),
            flip({ fallbackPlacements: ['bottom', 'top-start', 'bottom-start'] }),
            shift({ padding: 12 }),
            arrow({ element: arrowRef }),
        ],
        whileElementsMounted: autoUpdate,
    });

    // floating-ui@react's `elements.reference` rejects virtual elements at
    // runtime (even though the types accept `Element`), so we register the
    // virtual ref via `setPositionReference` in a layout effect. Position
    // computation is async (floating-ui uses computePosition which returns a
    // Promise), so the FIRST paint has no valid coords — we hide the floating
    // element via `visibility: hidden` until `isPositioned` flips true to
    // avoid the "appears at top of page" flash.
    useLayoutEffect(() => {
        refs.setPositionReference(virtualReference);
    }, [refs, virtualReference]);

    const dismiss = useDismiss(context, { outsidePress: false, escapeKey: true });
    const role = useRole(context, { role: 'dialog' });
    const { getFloatingProps } = useInteractions([dismiss, role]);

    const commit = () => {
        const trimmed = draft.trim();
        if (!trimmed) return;
        onSave(trimmed);
        onClose();
    };

    const arrowX = middlewareData.arrow?.x;
    const arrowY = middlewareData.arrow?.y;
    const sideMap = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' } as const;
    const primary = placement.split('-')[0] as keyof typeof sideMap;
    const staticSide: 'top' | 'right' | 'bottom' | 'left' = sideMap[primary] ?? 'bottom';

    const [placementSide, placementAlign] = placement.split('-');
    const originMain = sideMap[placementSide as keyof typeof sideMap] ?? 'center';
    const originCrossHoriz = placementSide === 'top' || placementSide === 'bottom';
    const originCross = !placementAlign
        ? (originCrossHoriz && arrowX != null ? `${arrowX}px` : 'center')
        : originCrossHoriz
            ? (placementAlign === 'start' ? 'left' : 'right')
            : (placementAlign === 'start' ? 'top' : 'bottom');
    const transformOrigin = originCrossHoriz ? `${originCross} ${originMain}` : `${originMain} ${originCross}`;

    return (
        <FloatingPortal>
            <FloatingFocusManager context={context} modal={false}>
                <div
                    ref={refs.setFloating}
                    style={{ ...floatingStyles, visibility: isPositioned ? 'visible' : 'hidden' }}
                    {...getFloatingProps()}
                    className={Z_INDEX.citationPreview}
                >
                    {/* Outer holds floating-ui positioning; inner owns entry animation.
                        Keeping them split prevents the zoom keyframes from overwriting
                        the positioning transform (see CLAUDE.md popover gotcha). */}
                    <div
                        style={{ transformOrigin }}
                        className={cn(
                            'relative w-[300px] rounded-lg shadow-xl border border-amber-300 dark:border-amber-700/60',
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
                            className="absolute w-2.5 h-2.5 rotate-45 bg-white dark:bg-slate-900 border-r border-b border-amber-300 dark:border-amber-700/60"
                        />

                        <div className="px-3 pt-2.5 pb-2 flex items-start gap-2">
                            <StickyNote size={14} className="text-amber-500 shrink-0 mt-0.5" aria-hidden />
                            <div className="flex-1 min-w-0">
                                <div className="text-[11px] italic text-amber-700 dark:text-amber-400 line-clamp-2">
                                    Ancorata a: &ldquo;{anchorText}&rdquo;
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                aria-label="Annulla"
                                className="p-1 -m-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
                            >
                                <X size={12} />
                            </button>
                        </div>

                        <div className="px-3 pb-3">
                            <textarea
                                autoFocus
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
                                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
                                }}
                                placeholder="Scrivi la nota…"
                                rows={3}
                                className="w-full resize-none rounded-md border border-amber-500/40 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                            />
                            <div className="flex items-center justify-between mt-2">
                                <span className="text-[10px] text-slate-400">⌘↵ per salvare</span>
                                <button
                                    onClick={commit}
                                    disabled={draft.trim().length === 0}
                                    className="px-3 py-1 text-xs font-medium rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 focus-visible:ring-offset-1"
                                >
                                    Salva
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </FloatingFocusManager>
        </FloatingPortal>
    );
}
