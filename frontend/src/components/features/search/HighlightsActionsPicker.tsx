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
} from '@floating-ui/react';
import { Eye, EyeOff, Download } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';

export interface HighlightsActionsPickerProps {
    isOpen: boolean;
    anchorEl: HTMLElement | null;
    /** Total number of highlights for the current article (used to disable actions when 0). */
    highlightsCount: number;
    /** True when highlights are currently rendered as transparent in the article body. */
    highlightsHidden: boolean;
    onClose: () => void;
    onToggleVisibility: () => void;
    onExportTxt: () => void;
}

/**
 * Tooltip-style floating bar anchored to the toolbar's highlight
 * button. Two icon-only actions: toggle visibility of `.highlight-mark`
 * spans and export the current highlights to a .txt file. Creation of
 * new highlights stays in the SelectionPopup.
 */
export function HighlightsActionsPicker({
    isOpen,
    anchorEl,
    highlightsCount,
    highlightsHidden,
    onClose,
    onToggleVisibility,
    onExportTxt,
}: HighlightsActionsPickerProps) {
    // Pass the anchor via `elements.reference` so the first render is already
    // positioned correctly. See matching comment in InlineNotePopover / NotesPeekPanel:
    // setting the reference in a useLayoutEffect would leave the initial frame
    // at document (0,0), which on a scrolled page means "above the viewport".
    const { refs, floatingStyles, context, placement } = useFloating({
        open: isOpen,
        onOpenChange: (open) => { if (!open) onClose(); },
        placement: 'bottom-end',
        elements: { reference: anchorEl },
        middleware: [
            offset(8),
            flip({ fallbackPlacements: ['top-end', 'bottom', 'top'] }),
            shift({ padding: 12 }),
        ],
        whileElementsMounted: autoUpdate,
    });

    const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true });
    const role = useRole(context, { role: 'dialog' });
    const { getFloatingProps } = useInteractions([dismiss, role]);

    if (!isOpen) return null;

    const empty = highlightsCount === 0;

    return (
        <FloatingPortal>
            <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
                <div
                    // eslint-disable-next-line react-hooks/refs -- floating-ui exposes a stable setter, not a ref.current read
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className={Z_INDEX.citationPreview}
                >
                    {/* Outer keeps floating-ui's positioning transform; inner
                        owns the entry animation so its scale doesn't fight
                        the translate. */}
                    <div
                        style={{ transformOrigin: getTransformOrigin(placement) }}
                        className={cn(
                            'flex items-center rounded-lg shadow-2xl overflow-hidden',
                            'bg-slate-900 dark:bg-slate-800 border border-slate-700/60',
                            'animate-in fade-in zoom-in-95 duration-150',
                        )}
                    >
                        <IconAction
                            icon={highlightsHidden ? <Eye size={15} /> : <EyeOff size={15} />}
                            title={
                                empty
                                    ? 'Nessuna evidenziazione'
                                    : highlightsHidden
                                        ? 'Mostra evidenziazioni'
                                        : 'Nascondi evidenziazioni'
                            }
                            pressed={highlightsHidden}
                            disabled={empty}
                            onClick={onToggleVisibility}
                        />
                        <div className="w-px h-5 bg-slate-700/70" aria-hidden />
                        <IconAction
                            icon={<Download size={15} />}
                            title={empty ? 'Nessuna evidenziazione da esportare' : 'Esporta in .txt'}
                            disabled={empty}
                            onClick={() => { onExportTxt(); onClose(); }}
                        />
                    </div>
                </div>
            </FloatingFocusManager>
        </FloatingPortal>
    );
}

interface IconActionProps {
    icon: React.ReactNode;
    title: string;
    pressed?: boolean;
    disabled?: boolean;
    onClick: () => void;
}

function IconAction({ icon, title, pressed, disabled, onClick }: IconActionProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            title={title}
            aria-label={title}
            aria-pressed={pressed}
            className={cn(
                'inline-flex items-center justify-center w-9 h-9 transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-purple-300/60',
                disabled
                    ? 'text-slate-600 cursor-not-allowed'
                    : pressed
                        ? 'bg-purple-500/20 text-purple-300'
                        : 'text-slate-300 hover:bg-slate-700 hover:text-white',
            )}
        >
            {icon}
        </button>
    );
}

function getTransformOrigin(placement: string): string {
    const [side, align] = placement.split('-') as [string, string | undefined];
    const opposite: Record<string, string> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };
    const main = opposite[side] ?? 'center';
    const crossAxisIsHorizontal = side === 'top' || side === 'bottom';
    const cross = !align
        ? 'center'
        : crossAxisIsHorizontal
            ? (align === 'start' ? 'left' : 'right')
            : (align === 'start' ? 'top' : 'bottom');
    return crossAxisIsHorizontal ? `${cross} ${main}` : `${main} ${cross}`;
}
