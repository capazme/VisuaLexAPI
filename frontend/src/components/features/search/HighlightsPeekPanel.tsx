import { useState, useEffect, useLayoutEffect, type RefObject } from 'react';
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
    size,
} from '@floating-ui/react';
import { Highlighter, X, Trash2 } from 'lucide-react';
import type { Highlight } from '../../../types';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { getHighlightSwatch } from '../../../utils/highlightColors';

export interface HighlightsPeekPanelProps {
    isOpen: boolean;
    anchorEl: HTMLElement | null;
    highlights: Highlight[];
    articleLabel: string;
    /** Ref to the article body container; used to scroll to a highlight mark on click. */
    contentRef: RefObject<HTMLDivElement | null>;
    onClose: () => void;
    onRemoveHighlight: (id: string) => void;
}

/**
 * Toolbar-anchored Peek for managing (not creating) highlights. Creation
 * of new highlights stays in the SelectionPopup that appears when the
 * user selects text; this panel is the inventory + delete + jump-to
 * view, mirroring the role of NotesPeekPanel for annotations.
 */
export function HighlightsPeekPanel(props: HighlightsPeekPanelProps) {
    const isDesktop = useIsDesktop();
    if (!props.isOpen) return null;
    return isDesktop ? <DesktopPeek {...props} /> : <MobileSheet {...props} />;
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

function DesktopPeek({ anchorEl, onClose, ...rest }: HighlightsPeekPanelProps) {
    const { refs, floatingStyles, context, placement } = useFloating({
        open: true,
        onOpenChange: (open) => { if (!open) onClose(); },
        placement: 'bottom-end',
        middleware: [
            offset(8),
            flip({ fallbackPlacements: ['top-end', 'bottom', 'top'] }),
            shift({ padding: 16 }),
            size({
                apply({ availableHeight, elements }) {
                    Object.assign(elements.floating.style, {
                        maxHeight: `${Math.max(280, Math.min(520, availableHeight - 16))}px`,
                    });
                },
                padding: 16,
            }),
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
                    {/* Split: outer holds floating-ui positioning transform,
                        inner owns the enter animation so the scale keyframes
                        don't overwrite the positioning translate. */}
                    <div
                        style={{ transformOrigin: getTransformOrigin(placement) }}
                        className={cn(
                            'w-[360px] flex flex-col rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700',
                            'bg-white dark:bg-slate-900 animate-in fade-in zoom-in-95 duration-150',
                        )}
                    >
                        <PeekBody onClose={onClose} {...rest} />
                    </div>
                </div>
            </FloatingFocusManager>
        </FloatingPortal>
    );
}

// ───────────────────────── MOBILE BOTTOM SHEET ─────────────────────────

function MobileSheet({ onClose, ...rest }: HighlightsPeekPanelProps) {
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
                    'max-h-[70vh] animate-in slide-in-from-bottom duration-200',
                    Z_INDEX.citationPreview,
                )}
            >
                <div className="flex justify-center pt-2 pb-1">
                    <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
                </div>
                <PeekBody onClose={onClose} {...rest} />
            </div>
        </FloatingPortal>
    );
}

// ───────────────────────── SHARED BODY ─────────────────────────

type BodyProps = Omit<HighlightsPeekPanelProps, 'anchorEl' | 'isOpen'>;

function PeekBody({
    highlights,
    articleLabel,
    contentRef,
    onClose,
    onRemoveHighlight,
}: BodyProps) {
    const scrollToHighlight = (id: string) => {
        const target = contentRef.current?.querySelector<HTMLElement>(`[data-highlight="${id}"]`);
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Brief pulse so the user sees where it landed.
        target.classList.add('highlight-flash');
        setTimeout(() => target.classList.remove('highlight-flash'), 1200);
    };

    return (
        <>
            <header className="px-4 py-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2 min-w-0">
                    <Highlighter size={16} className="text-purple-500 shrink-0" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        Evidenziazioni su {articleLabel}
                    </h3>
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">
                        {highlights.length}
                    </span>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                    title="Chiudi (Esc)"
                    aria-label="Chiudi pannello evidenziazioni"
                >
                    <X size={16} />
                </button>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                {highlights.length === 0 ? (
                    <div className="py-6 text-center space-y-2">
                        <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                            Nessuna evidenziazione su questo articolo.
                        </p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                            Seleziona del testo nell'articolo per evidenziarlo.
                        </p>
                    </div>
                ) : (
                    highlights.map(h => (
                        <HighlightCard
                            key={h.id}
                            highlight={h}
                            onJumpTo={() => scrollToHighlight(h.id)}
                            onRemove={() => onRemoveHighlight(h.id)}
                        />
                    ))
                )}
            </div>

            <div className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">
                    Seleziona del testo nell'articolo per creare nuove evidenziazioni.
                </p>
            </div>
        </>
    );
}

interface HighlightCardProps {
    highlight: Highlight;
    onJumpTo: () => void;
    onRemove: () => void;
}

function HighlightCard({ highlight, onJumpTo, onRemove }: HighlightCardProps) {
    return (
        <div className="group relative rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-2.5 text-sm">
            <button
                onClick={onJumpTo}
                className="w-full text-left flex items-start gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 rounded"
                title="Vai a questa evidenziazione"
            >
                <span
                    className="shrink-0 w-3 h-3 mt-1 rounded-full ring-1 ring-slate-300 dark:ring-slate-600"
                    style={{ backgroundColor: getHighlightSwatch(highlight.color) }}
                    aria-hidden
                />
                <span className="flex-1 whitespace-pre-wrap text-slate-800 dark:text-slate-200 line-clamp-3 pr-6">
                    {highlight.text}
                </span>
            </button>
            <button
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                className="absolute top-1.5 right-1.5 p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                title="Rimuovi evidenziazione"
                aria-label="Rimuovi evidenziazione"
            >
                <Trash2 size={12} />
            </button>
        </div>
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
