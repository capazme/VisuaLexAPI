import { useState, useEffect, useLayoutEffect } from 'react';
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
import { Highlighter, X, Eye, EyeOff, Download } from 'lucide-react';
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
 * Compact actions picker anchored to the toolbar's highlight button.
 * Two actions only — toggle visibility of `.highlight-mark` spans in the
 * article body, and export the current highlights to a .txt file.
 * Creation of new highlights stays in the SelectionPopup.
 */
export function HighlightsActionsPicker(props: HighlightsActionsPickerProps) {
    const isDesktop = useIsDesktop();
    if (!props.isOpen) return null;
    return isDesktop ? <DesktopPicker {...props} /> : <MobileSheet {...props} />;
}

function useIsDesktop(): boolean {
    const [desktop, setDesktop] = useState(() =>
        typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true,
    );
    useEffect(() => {
        const mql = window.matchMedia('(min-width: 768px)');
        const handler = (e: MediaQueryListEvent) => setDesktop(e.matches);
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
    }, []);
    return desktop;
}

// ───────────────────────── DESKTOP POPOVER ─────────────────────────

function DesktopPicker({ anchorEl, onClose, ...rest }: HighlightsActionsPickerProps) {
    const { refs, floatingStyles, context, placement } = useFloating({
        open: true,
        onOpenChange: (open) => { if (!open) onClose(); },
        placement: 'bottom-end',
        middleware: [
            offset(8),
            flip({ fallbackPlacements: ['top-end', 'bottom', 'top'] }),
            shift({ padding: 16 }),
        ],
        whileElementsMounted: autoUpdate,
    });

    useLayoutEffect(() => {
        refs.setReference(anchorEl);
    }, [anchorEl, refs]);

    const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true });
    const role = useRole(context, { role: 'dialog' });
    const { getFloatingProps } = useInteractions([dismiss, role]);

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
                    {/* Outer keeps the positioning transform from floating-ui;
                        inner owns the entry animation so the scale transform
                        doesn't fight the translate. */}
                    <div
                        style={{ transformOrigin: getTransformOrigin(placement) }}
                        className={cn(
                            'w-[180px] rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700',
                            'bg-white dark:bg-slate-900 animate-in fade-in zoom-in-95 duration-150',
                        )}
                    >
                        <PickerBody onClose={onClose} {...rest} />
                    </div>
                </div>
            </FloatingFocusManager>
        </FloatingPortal>
    );
}

// ───────────────────────── MOBILE BOTTOM SHEET ─────────────────────────

function MobileSheet({ onClose, ...rest }: HighlightsActionsPickerProps) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <FloatingPortal>
            <div
                className={cn('fixed inset-0 bg-black/30 animate-in fade-in duration-150', Z_INDEX.citationPreview)}
                onClick={onClose}
                aria-hidden
            />
            <div
                role="dialog"
                aria-modal="true"
                className={cn(
                    'fixed inset-x-0 bottom-0 flex flex-col rounded-t-2xl shadow-2xl',
                    'bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800',
                    'animate-in slide-in-from-bottom duration-200',
                    Z_INDEX.citationPreview,
                )}
            >
                <div className="flex justify-center pt-2 pb-1">
                    <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
                </div>
                <PickerBody onClose={onClose} {...rest} />
            </div>
        </FloatingPortal>
    );
}

// ───────────────────────── SHARED BODY ─────────────────────────

type BodyProps = Omit<HighlightsActionsPickerProps, 'anchorEl' | 'isOpen'>;

function PickerBody({
    highlightsCount,
    highlightsHidden,
    onClose,
    onToggleVisibility,
    onExportTxt,
}: BodyProps) {
    const empty = highlightsCount === 0;

    return (
        <>
            <header className="px-3 py-2.5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2 min-w-0">
                    <Highlighter size={14} className="text-purple-500 shrink-0" />
                    <h3 className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        Evidenziazioni
                    </h3>
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                        {highlightsCount}
                    </span>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                    title="Chiudi (Esc)"
                    aria-label="Chiudi picker evidenziazioni"
                >
                    <X size={14} />
                </button>
            </header>

            <div className="p-2 flex items-center justify-center gap-2">
                <IconAction
                    icon={highlightsHidden ? <Eye size={18} /> : <EyeOff size={18} />}
                    title={
                        empty
                            ? 'Nessuna evidenziazione'
                            : highlightsHidden
                                ? 'Mostra evidenziazioni'
                                : 'Nascondi evidenziazioni'
                    }
                    pressed={highlightsHidden}
                    disabled={empty}
                    onClick={() => { onToggleVisibility(); }}
                />
                <IconAction
                    icon={<Download size={18} />}
                    title={empty ? 'Nessuna evidenziazione da esportare' : 'Esporta in .txt'}
                    disabled={empty}
                    onClick={() => { onExportTxt(); onClose(); }}
                />
            </div>
        </>
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
                'inline-flex items-center justify-center w-10 h-10 rounded-lg transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
                disabled
                    ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                    : pressed
                        ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300'
                        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-purple-500',
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
