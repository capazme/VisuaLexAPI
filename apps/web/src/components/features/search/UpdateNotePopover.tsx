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
import { X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';

export interface UpdateNotePopoverProps {
    noteId: string;
    /** The note's paragraphs as plain text (`getUpdateNoteParagraphs`). */
    paragraphs: string[];
    /** The "(119)" chip in the article text. */
    anchorEl: HTMLElement;
    onClose: () => void;
}

/**
 * A Normattiva update note ("AGGIORNAMENTO (119)"), opened from its reference
 * in the text. It floats over the text instead of opening inside it, so the
 * commi below do not move while the reader consults it; Esc or a click
 * outside closes it and focus returns to the reference.
 */
export function UpdateNotePopover({ noteId, paragraphs, anchorEl, onClose }: UpdateNotePopoverProps) {
    // The anchor goes straight to useFloating so the first frame is already
    // positioned (CLAUDE.md gotcha 13).
    const { refs, floatingStyles, context, placement } = useFloating({
        open: true,
        onOpenChange: (open) => { if (!open) onClose(); },
        placement: 'bottom-start',
        elements: { reference: anchorEl },
        middleware: [
            offset(8),
            flip({ fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }),
            shift({ padding: 12 }),
        ],
        whileElementsMounted: autoUpdate,
    });
    const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true });
    const role = useRole(context, { role: 'dialog' });
    const { getFloatingProps } = useInteractions([dismiss, role]);

    // Grow the entry animation from the corner that faces the chip.
    const [side, align] = placement.split('-');
    const transformOrigin = `${align === 'end' ? 'right' : 'left'} ${side === 'top' ? 'bottom' : 'top'}`;
    const titleId = `update-note-title-${noteId}`;

    return (
        <FloatingPortal>
            <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
                {/* Outer element: floating-ui positioning only. */}
                <div
                    // eslint-disable-next-line react-hooks/refs -- floating-ui exposes a stable setter, not a ref.current read
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    aria-labelledby={titleId}
                    className={Z_INDEX.citationPreview}
                >
                    {/* Inner element: the entry animation, so its scale does not
                        overwrite the positioning transform (gotcha 10). */}
                    <div
                        style={{ transformOrigin }}
                        className={cn(
                            'w-[min(24rem,calc(100vw-2rem))] max-h-[60vh] overflow-y-auto rounded-lg border shadow-xl',
                            'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
                            'animate-in fade-in zoom-in-95 duration-150',
                        )}
                    >
                        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-100 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900">
                            <span id={titleId} className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Aggiornamento ({noteId})
                            </span>
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Chiudi nota"
                                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 md:min-w-0 md:p-1 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            >
                                <X size={14} aria-hidden />
                            </button>
                        </div>
                        <div className="space-y-2 px-3 py-2.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                            {paragraphs.length > 0 ? (
                                paragraphs.map((paragraph, i) => <p key={i}>{paragraph}</p>)
                            ) : (
                                <p className="italic text-slate-400">La nota non ha testo nella versione scaricata.</p>
                            )}
                        </div>
                    </div>
                </div>
            </FloatingFocusManager>
        </FloatingPortal>
    );
}
