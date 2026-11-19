import { useState, useMemo, useRef } from 'react';
import { StickyNote, X, BookOpen, Download } from 'lucide-react';
import type { Annotation } from '../../../types';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { Textarea } from '../../ui/Textarea';
import { NoteCard } from './NoteCard';
import { ReaderSpace } from './ReaderSpace';
import { useNoteEditing } from '../../../hooks/useNoteEditing';

export interface NotesPeekPanelProps {
    isOpen: boolean;
    annotations: Annotation[];
    articleLabel: string;
    noteAnchor: { anchorText: string; startOffset: number; scopedArticleId: string } | null;
    onClose: () => void;
    onAddNote: (text: string) => void;
    onUpdateNote: (id: string, text: string) => void;
    onRemoveNote: (id: string) => void;
    onClearAnchor: () => void;
    onOpenStudyMode?: () => void;
    onExportTxt: () => void;
    /** What the list says when there are no notes (default: the article's sentence). */
    emptyText?: string;
}

/**
 * «Note» under the reading toolbar (LC139, L-73; it was a popover on a computer and a sheet on a phone): the notes on
 * the article or the decision, edited and removed in place, and a new one. The focus lands on the space, never in the
 * field; Esc and «Chiudi» close it and the focus goes back to the toolbar's button.
 */
export function NotesPeekPanel({ isOpen, onClose, articleLabel, annotations, ...rest }: NotesPeekPanelProps) {
    return (
        <ReaderSpace
            open={isOpen}
            onClose={onClose}
            title={`Note su ${articleLabel}`}
            line={annotations.length > 0 ? `${annotations.length} ${annotations.length === 1 ? 'nota' : 'note'}` : undefined}
            icon={<StickyNote size={16} aria-hidden className="shrink-0 text-amber-500" />}
            className="max-w-xl"
        >
            <PeekBody onClose={onClose} annotations={annotations} {...rest} />
        </ReaderSpace>
    );
}

type BodyProps = Omit<NotesPeekPanelProps, 'isOpen' | 'articleLabel'>;

function PeekBody({
    annotations,
    noteAnchor,
    onClose,
    onAddNote,
    onUpdateNote,
    onRemoveNote,
    onClearAnchor,
    onOpenStudyMode,
    onExportTxt,
    emptyText = 'Nessuna nota su questo articolo.',
}: BodyProps) {
    const { editingId, editingText, setEditingText, startEdit, commitEdit, cancelEdit } = useNoteEditing(annotations, onUpdateNote);
    const [composerText, setComposerText] = useState('');
    // A button pressed that goes (a note removed) or turns off («Salva», the field emptied) would drop the focus to the
    // page, where Esc no longer reaches the space: it goes to the list, or stays in the field.
    const listRef = useRef<HTMLDivElement>(null);
    const composerRef = useRef<HTMLTextAreaElement>(null);
    const removeNote = (id: string) => {
        onRemoveNote(id);
        listRef.current?.focus();
    };
    const [ownerFilter, setOwnerFilter] = useState<'all' | 'own' | 'imported'>('all');

    const visibleNotes = useMemo(() => {
        if (ownerFilter === 'own') return annotations.filter((n) => !n.sourceSuggestionId);
        if (ownerFilter === 'imported') return annotations.filter((n) => !!n.sourceSuggestionId);
        return annotations;
    }, [annotations, ownerFilter]);

    const submitComposer = () => {
        const trimmed = composerText.trim();
        if (!trimmed) return;
        onAddNote(trimmed);
        setComposerText('');
        composerRef.current?.focus();
    };

    const { anchoredNotes, freeNotes } = groupByAnchor(visibleNotes);

    const hasImported = annotations.some((n) => !!n.sourceSuggestionId);

    return (
        <>
            <div className="mb-2 flex flex-wrap items-center gap-1">
                {hasImported && (['all', 'own', 'imported'] as const).map((key) => (
                    <Button key={key} size="sm" variant={ownerFilter === key ? 'primary' : 'quiet'} aria-pressed={ownerFilter === key} onClick={() => setOwnerFilter(key)}>
                        {key === 'all' ? 'Tutte' : key === 'own' ? 'Mie' : 'Importate'}
                    </Button>
                ))}
                <Button size="sm" variant="quiet" className="ml-auto" onClick={onExportTxt} disabled={annotations.length === 0}>
                    <Download size={14} aria-hidden />
                    Esporta in .txt
                </Button>
            </div>

            <div ref={listRef} tabIndex={-1} className="max-h-[50vh] space-y-3 overflow-y-auto py-1 outline-none">
                {visibleNotes.length === 0 && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 italic text-center py-6">
                        {annotations.length === 0
                            ? emptyText
                            : 'Nessuna nota corrisponde al filtro selezionato.'}
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
                        onRemove={removeNote}
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
                        onRemove={removeNote}
                    />
                )}
            </div>

            <div className="mt-2 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                {noteAnchor && (
                    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-amber-100/70 dark:bg-amber-900/30 rounded-md text-xs border border-amber-300/60 dark:border-amber-800/40">
                        <StickyNote size={12} className="text-amber-600 dark:text-amber-400 shrink-0" />
                        <span className="italic flex-1 truncate text-amber-800 dark:text-amber-300">
                            Ancorata a: &ldquo;{noteAnchor.anchorText}&rdquo;
                        </span>
                        <IconButton size="sm" variant="quiet" onClick={onClearAnchor} title="Rimuovi ancoraggio" aria-label="Rimuovi ancoraggio" icon={<X aria-hidden />} />
                    </div>
                )}

                <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                    <Textarea
                        ref={composerRef}
                        aria-label={noteAnchor ? 'Nota ancorata' : 'Nuova nota'}
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
                        className="resize-none"
                    />
                    </div>
                    <Button variant="primary" onClick={submitComposer} disabled={!composerText.trim()}>
                        Salva
                    </Button>
                </div>

                {onOpenStudyMode && (
                    <Button variant="quiet" size="sm" className="w-full" onClick={() => { onOpenStudyMode(); onClose(); }}>
                        <BookOpen size={14} aria-hidden /> Apri in Modalità Studio
                    </Button>
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
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
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

