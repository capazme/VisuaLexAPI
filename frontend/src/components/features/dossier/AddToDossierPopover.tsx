import { useState, useEffect, useMemo, type FormEvent } from 'react';
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
import { Folder, FolderPlus, Check, X, Search } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { dossierRecency, dossierContainsArticle } from './dossierUtils';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import type { NormaVisitata } from '../../../types';

export interface AddToDossierPopoverProps {
    isOpen: boolean;
    /** Desktop anchor; when null (or the viewport is mobile-sized) the popover renders as a bottom sheet. */
    anchorEl: HTMLElement | null;
    onClose: () => void;
    norma: NormaVisitata;
    /** Fired after a successful add (existing or newly-created dossier); parent toasts + offers "Apri". */
    onAdded: (dossierId: string, dossierTitle: string) => void;
    /**
     * Fired when the user picks a dossier that already contains this article.
     * Per spec, the click does nothing except a neutral toast — the popover
     * stays open and no add happens.
     */
    onDuplicate?: (dossierTitle: string) => void;
}

/**
 * Minimal media query hook: `true` when viewport is desktop-sized. Mirrors
 * the identical helper in NotesPeekPanel.tsx — kept local rather than
 * shared since these two popovers are the only ones needing the desktop
 * popover vs. mobile bottom-sheet split.
 */
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

export function AddToDossierPopover({ isOpen, anchorEl, onClose, norma, onAdded, onDuplicate }: AddToDossierPopoverProps) {
    const isDesktopViewport = useIsDesktop();
    if (!isOpen) return null;
    return isDesktopViewport && anchorEl
        ? <DesktopPopover anchorEl={anchorEl} onClose={onClose} norma={norma} onAdded={onAdded} onDuplicate={onDuplicate} />
        : <MobileSheet onClose={onClose} norma={norma} onAdded={onAdded} onDuplicate={onDuplicate} />;
}

type BodyProps = {
    norma: NormaVisitata;
    onClose: () => void;
    onAdded: (dossierId: string, dossierTitle: string) => void;
    onDuplicate?: (dossierTitle: string) => void;
};

// ───────────────────────── DESKTOP POPOVER ─────────────────────────

function DesktopPopover({ anchorEl, onClose, norma, onAdded, onDuplicate }: BodyProps & { anchorEl: HTMLElement }) {
    // Pass the anchor through `elements.reference` so the FIRST render
    // already has a valid position — see the identical comment in
    // NotesPeekPanel.tsx / InlineNotePopover.tsx (gotcha #13).
    const { refs, floatingStyles, context, placement } = useFloating({
        open: true,
        onOpenChange: (open) => { if (!open) onClose(); },
        placement: 'bottom-start',
        elements: { reference: anchorEl },
        middleware: [
            offset(8),
            flip({ fallbackPlacements: ['top-start', 'bottom', 'top'] }),
            shift({ padding: 16 }),
        ],
        whileElementsMounted: autoUpdate,
    });

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
                    {/*
                        Inner wrapper owns the enter animation, kept apart from
                        the outer positioning element — otherwise the
                        zoom-in-95 scale transform overwrites floating-ui's
                        translate and the popover visibly jumps from (0,0).
                    */}
                    <div
                        style={{ transformOrigin: getTransformOrigin(placement) }}
                        className={cn(
                            'w-72 flex flex-col rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700',
                            'bg-white dark:bg-slate-900 animate-in fade-in zoom-in-95 duration-150',
                        )}
                    >
                        <PopoverBody norma={norma} onClose={onClose} onAdded={onAdded} onDuplicate={onDuplicate} />
                    </div>
                </div>
            </FloatingFocusManager>
        </FloatingPortal>
    );
}

// ───────────────────────── MOBILE BOTTOM SHEET ─────────────────────────

function MobileSheet({ onClose, norma, onAdded, onDuplicate }: BodyProps) {
    // Close on Escape even on mobile (useful for external keyboards).
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
                    'fixed inset-x-4 bottom-4 flex flex-col rounded-2xl shadow-2xl',
                    'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800',
                    'max-h-[70vh] animate-in slide-in-from-bottom duration-200',
                    Z_INDEX.citationPreview,
                )}
            >
                <PopoverBody norma={norma} onClose={onClose} onAdded={onAdded} onDuplicate={onDuplicate} />
            </div>
        </FloatingPortal>
    );
}

// ───────────────────────── SHARED BODY ─────────────────────────

function PopoverBody({ norma, onClose, onAdded, onDuplicate }: BodyProps) {
    const { dossiers, addToDossier, createDossier } = useAppStore(useShallow((s) => ({
        dossiers: s.dossiers, addToDossier: s.addToDossier, createDossier: s.createDossier,
    })));
    const [query, setQuery] = useState('');
    const [creating, setCreating] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [busy, setBusy] = useState(false);

    const sorted = useMemo(() => {
        const q = query.trim().toLowerCase();
        return [...dossiers]
            .filter(d => !q || d.title.toLowerCase().includes(q))
            .sort((a, b) => dossierRecency(b) - dossierRecency(a));
    }, [dossiers, query]);
    const visible = query.trim() ? sorted : sorted.slice(0, 5);

    const handlePick = (dossierId: string) => {
        const target = dossiers.find(d => d.id === dossierId);
        if (!target) return;
        if (dossierContainsArticle(target, norma)) {
            // Per spec: clicking a dossier that already has this article does
            // nothing except a neutral toast. Popover stays open.
            onDuplicate?.(target.title);
            return;
        }
        addToDossier(dossierId, norma, 'norma');
        onAdded(dossierId, target.title);
        onClose();
    };

    const handleCreate = async (e: FormEvent) => {
        e.preventDefault();
        const title = newTitle.trim();
        if (!title || busy) return;
        setBusy(true);
        const id = await createDossier(title);
        setBusy(false);
        if (!id) return; // creation failed: stay open, the name is not lost
        addToDossier(id, norma, 'norma');
        onAdded(id, title);
        onClose();
    };

    return (
        <>
            <header className="px-4 py-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <Folder size={16} className="text-primary-500 shrink-0" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        Aggiungi a dossier
                    </h3>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                    title="Chiudi (Esc)"
                    aria-label="Chiudi"
                >
                    <X size={16} />
                </button>
            </header>

            {dossiers.length > 5 && (
                <div className="px-3 pt-2 shrink-0">
                    <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Cerca dossier…"
                            className="w-full pl-8 pr-2.5 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/40 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                        />
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 min-h-[80px]">
                {visible.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400 italic text-center py-6">
                        {dossiers.length === 0 ? 'Nessun dossier presente.' : 'Nessun dossier corrisponde alla ricerca.'}
                    </p>
                ) : (
                    visible.map((d) => {
                        const alreadyPresent = dossierContainsArticle(d, norma);
                        return (
                            <button
                                key={d.id}
                                type="button"
                                aria-disabled={alreadyPresent}
                                onClick={() => handlePick(d.id)}
                                className={cn(
                                    'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
                                    alreadyPresent
                                        ? 'opacity-60 cursor-default'
                                        : 'hover:bg-primary-50 dark:hover:bg-primary-900/10',
                                )}
                            >
                                <Folder size={16} className="text-primary-500 shrink-0" />
                                <span className="flex-1 min-w-0 truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                                    {d.title}
                                </span>
                                {alreadyPresent ? (
                                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
                                        <Check size={12} /> già presente
                                    </span>
                                ) : (
                                    <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">
                                        {d.items.length} elementi
                                    </span>
                                )}
                            </button>
                        );
                    })
                )}
            </div>

            <div className="px-3 py-2.5 border-t border-slate-200 dark:border-slate-800 shrink-0">
                {!creating ? (
                    <button
                        type="button"
                        onClick={() => setCreating(true)}
                        className={cn(
                            'w-full flex items-center justify-center gap-2 py-2 border-2 border-dashed rounded-lg transition-colors text-sm',
                            'border-slate-300 dark:border-slate-700 text-slate-500',
                            'hover:border-primary-500 hover:text-primary-500',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40',
                        )}
                    >
                        <FolderPlus size={16} /> Nuovo dossier…
                    </button>
                ) : (
                    <form aria-label="Crea dossier" onSubmit={handleCreate} className="flex gap-2">
                        <input
                            type="text"
                            autoFocus
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setCreating(false); }}
                            placeholder="Nome del dossier…"
                            className="flex-1 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500/40 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                        />
                        <button
                            type="submit"
                            disabled={busy || !newTitle.trim()}
                            className="px-3 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Crea e aggiungi
                        </button>
                    </form>
                )}
            </div>
        </>
    );
}

// ───────────────────────── HELPERS ─────────────────────────

/**
 * Translate a floating-ui placement into the CSS transform-origin that
 * corresponds to the edge of the popover touching the reference — see the
 * identical helper in NotesPeekPanel.tsx / HighlightsActionsPicker.tsx.
 */
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
