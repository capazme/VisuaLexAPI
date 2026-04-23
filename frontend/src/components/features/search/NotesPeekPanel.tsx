import { useState, useEffect, useRef, useLayoutEffect } from 'react';
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
import { StickyNote, X, BookOpen, Trash2 } from 'lucide-react';
import type { Annotation } from '../../../types';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';

export interface NotesPeekPanelProps {
    isOpen: boolean;
    anchorEl: HTMLElement | null;
    annotations: Annotation[];
    articleLabel: string;
    noteAnchor: { anchorText: string; startOffset: number; scopedArticleId: string } | null;
    onClose: () => void;
    onAddNote: (text: string) => void;
    onUpdateNote: (id: string, text: string) => void;
    onRemoveNote: (id: string) => void;
    onClearAnchor: () => void;
    onOpenStudyMode?: () => void;
}

/**
 * Minimal media query hook: `true` when viewport is desktop-sized.
 * Intentionally lightweight — no SSR, no breakpoint config — we only
 * need to pick between a floating popover and a bottom sheet.
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

export function NotesPeekPanel(props: NotesPeekPanelProps) {
    const isDesktop = useIsDesktop();
    if (!props.isOpen) return null;
    return isDesktop ? <DesktopPeek {...props} /> : <MobileSheet {...props} />;
}

type BodyProps = Omit<NotesPeekPanelProps, 'anchorEl'> & {
    isDesktop?: boolean;
};

// ───────────────────────── DESKTOP POPOVER ─────────────────────────

function DesktopPeek({ anchorEl, onClose, ...rest }: NotesPeekPanelProps) {
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

    // Keep the external anchor element in sync with floating-ui's reference.
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
                    {/*
                        Inner wrapper owns the enter animation (which itself
                        uses `transform`). Keeping it separate from the outer
                        element prevents the zoom-in-95 keyframes from
                        overwriting floating-ui's positioning transform —
                        without this split the popover visibly slides from
                        (0,0) to its anchored position each time it opens.
                    */}
                    <div
                        style={{ transformOrigin: getTransformOrigin(placement) }}
                        className={cn(
                            'w-[360px] flex flex-col rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700',
                            'bg-white dark:bg-slate-900 animate-in fade-in zoom-in-95 duration-150',
                        )}
                    >
                        <PeekBody onClose={onClose} {...rest} isDesktop />
                    </div>
                </div>
            </FloatingFocusManager>
        </FloatingPortal>
    );
}

// ───────────────────────── MOBILE BOTTOM SHEET ─────────────────────────

function MobileSheet({ onClose, ...rest }: NotesPeekPanelProps) {
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

function PeekBody({
    annotations,
    articleLabel,
    noteAnchor,
    onClose,
    onAddNote,
    onUpdateNote,
    onRemoveNote,
    onClearAnchor,
    onOpenStudyMode,
}: BodyProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingText, setEditingText] = useState('');
    const [composerText, setComposerText] = useState('');
    const composerRef = useRef<HTMLTextAreaElement>(null);

    // Autofocus composer when an anchor is passed in (user arrived via
    // "Aggiungi nota" from the selection popup) — skip otherwise to
    // avoid stealing focus from the article.
    useEffect(() => {
        if (noteAnchor) composerRef.current?.focus();
    }, [noteAnchor]);

    const startEdit = (note: Annotation) => {
        setEditingId(note.id);
        setEditingText(note.text);
    };

    const commitEdit = () => {
        if (!editingId) return;
        const trimmed = editingText.trim();
        const original = annotations.find(a => a.id === editingId);
        if (original && trimmed && trimmed !== original.text) {
            onUpdateNote(editingId, trimmed);
        }
        setEditingId(null);
        setEditingText('');
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditingText('');
    };

    const submitComposer = () => {
        const trimmed = composerText.trim();
        if (!trimmed) return;
        onAddNote(trimmed);
        setComposerText('');
    };

    const { anchoredNotes, freeNotes } = groupByAnchor(annotations);

    return (
        <>
            <header className="px-4 py-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2 min-w-0">
                    <StickyNote size={16} className="text-amber-500 shrink-0" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        Note su {articleLabel}
                    </h3>
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">
                        {annotations.length}
                    </span>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                    title="Chiudi (Esc)"
                    aria-label="Chiudi pannello note"
                >
                    <X size={16} />
                </button>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {annotations.length === 0 && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 italic text-center py-6">
                        Nessuna nota su questo articolo.
                    </p>
                )}

                {anchoredNotes.length > 0 && (
                    <NoteGroup
                        label="Ancorate al testo"
                        notes={anchoredNotes}
                        editingId={editingId}
                        editingText={editingText}
                        onStartEdit={startEdit}
                        onChangeEdit={setEditingText}
                        onCommitEdit={commitEdit}
                        onCancelEdit={cancelEdit}
                        onRemove={onRemoveNote}
                    />
                )}

                {freeNotes.length > 0 && (
                    <NoteGroup
                        label="Libere"
                        notes={freeNotes}
                        editingId={editingId}
                        editingText={editingText}
                        onStartEdit={startEdit}
                        onChangeEdit={setEditingText}
                        onCommitEdit={commitEdit}
                        onCancelEdit={cancelEdit}
                        onRemove={onRemoveNote}
                    />
                )}
            </div>

            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                {noteAnchor && (
                    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-amber-100/70 dark:bg-amber-900/30 rounded-md text-xs border border-amber-300/60 dark:border-amber-800/40">
                        <StickyNote size={12} className="text-amber-600 dark:text-amber-400 shrink-0" />
                        <span className="italic flex-1 truncate text-amber-800 dark:text-amber-300">
                            Ancorata a: &ldquo;{noteAnchor.anchorText}&rdquo;
                        </span>
                        <button
                            onClick={onClearAnchor}
                            className="p-0.5 rounded text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-800/50 transition-colors"
                            title="Rimuovi ancoraggio"
                            aria-label="Rimuovi ancoraggio"
                        >
                            <X size={12} />
                        </button>
                    </div>
                )}

                <div className="flex items-end gap-2">
                    <textarea
                        ref={composerRef}
                        value={composerText}
                        onChange={(e) => setComposerText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                e.preventDefault();
                                submitComposer();
                            }
                        }}
                        placeholder={noteAnchor ? 'Scrivi la nota ancorata…' : 'Aggiungi una nota…'}
                        rows={2}
                        className="flex-1 text-sm resize-none rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                    />
                    <button
                        onClick={submitComposer}
                        disabled={!composerText.trim()}
                        className="self-stretch px-3 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 active:bg-amber-700 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Salva
                    </button>
                </div>

                {onOpenStudyMode && (
                    <button
                        onClick={() => { onOpenStudyMode(); onClose(); }}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                    >
                        <BookOpen size={13} /> Apri in Modalità Studio
                    </button>
                )}
            </div>
        </>
    );
}

// ───────────────────────── SUBCOMPONENTS ─────────────────────────

interface NoteGroupProps {
    label: string;
    notes: Annotation[];
    editingId: string | null;
    editingText: string;
    onStartEdit: (note: Annotation) => void;
    onChangeEdit: (text: string) => void;
    onCommitEdit: () => void;
    onCancelEdit: () => void;
    onRemove: (id: string) => void;
}

function NoteGroup({ label, notes, editingId, editingText, onStartEdit, onChangeEdit, onCommitEdit, onCancelEdit, onRemove }: NoteGroupProps) {
    return (
        <div className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {label}
            </h4>
            {notes.map(note => (
                <NoteCard
                    key={note.id}
                    note={note}
                    isEditing={editingId === note.id}
                    editingText={editingText}
                    onStartEdit={() => onStartEdit(note)}
                    onChangeEdit={onChangeEdit}
                    onCommitEdit={onCommitEdit}
                    onCancelEdit={onCancelEdit}
                    onRemove={() => onRemove(note.id)}
                />
            ))}
        </div>
    );
}

interface NoteCardProps {
    note: Annotation;
    isEditing: boolean;
    editingText: string;
    onStartEdit: () => void;
    onChangeEdit: (text: string) => void;
    onCommitEdit: () => void;
    onCancelEdit: () => void;
    onRemove: () => void;
}

function NoteCard({ note, isEditing, editingText, onStartEdit, onChangeEdit, onCommitEdit, onCancelEdit, onRemove }: NoteCardProps) {
    return (
        <div className="group relative rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-2.5 text-sm">
            {note.anchorText && (
                <div className="text-[11px] italic text-amber-700 dark:text-amber-400 mb-1 line-clamp-1 pr-6">
                    &ldquo;{note.anchorText}&rdquo;
                </div>
            )}

            {isEditing ? (
                <textarea
                    autoFocus
                    value={editingText}
                    onChange={(e) => onChangeEdit(e.target.value)}
                    onBlur={onCommitEdit}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') { e.preventDefault(); onCancelEdit(); }
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onCommitEdit(); }
                    }}
                    rows={Math.max(2, editingText.split('\n').length)}
                    className="w-full resize-none rounded-md border border-amber-500/50 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                />
            ) : (
                <button
                    onClick={onStartEdit}
                    className="w-full text-left whitespace-pre-wrap text-slate-800 dark:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 rounded"
                    title="Clicca per modificare"
                >
                    {note.text}
                </button>
            )}

            <button
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                className="absolute top-1.5 right-1.5 p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                title="Elimina nota"
                aria-label="Elimina nota"
            >
                <Trash2 size={12} />
            </button>
        </div>
    );
}

// ───────────────────────── HELPERS ─────────────────────────

function groupByAnchor(annotations: Annotation[]): { anchoredNotes: Annotation[]; freeNotes: Annotation[] } {
    const anchoredNotes: Annotation[] = [];
    const freeNotes: Annotation[] = [];
    for (const n of annotations) {
        if (n.anchorText) anchoredNotes.push(n);
        else freeNotes.push(n);
    }
    return { anchoredNotes, freeNotes };
}

/**
 * Translate a floating-ui placement into the CSS transform-origin that
 * corresponds to the edge of the popover touching the reference — so
 * the scale-in animation grows FROM the anchor instead of from the
 * popover's geometric center (which otherwise reads as "dropping from
 * above" because the popover's centre is far from the toolbar button).
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
