import { LocateFixed, Trash2 } from 'lucide-react';
import type { Annotation } from '../../../types';
import { cn } from '../../../lib/utils';
import { AttributionChip } from '../bulletin/AttributionChip';

export interface NoteCardProps {
    note: Annotation;
    isEditing: boolean;
    editingText: string;
    onStartEdit: () => void;
    onChangeEdit: (text: string) => void;
    onCommitEdit: () => void;
    onCancelEdit: () => void;
    onRemove: () => void;
    /** Adds "Vai al passo": show the note's anchor in the article text. */
    onGoTo?: () => void;
}

/**
 * One note, read or edited in place — the Notes panel's cards and the block
 * popover's. A click on the text edits it; blur or Cmd/Ctrl+Enter saves, Esc
 * cancels. The delete button appears on hover from `md` up and is always
 * there, at a 44 px target, below it: a touch screen has no hover.
 */
export function NoteCard({ note, isEditing, editingText, onStartEdit, onChangeEdit, onCommitEdit, onCancelEdit, onRemove, onGoTo }: NoteCardProps) {
    return (
        <div className="group relative rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-2.5 text-sm">
            {note.anchorText && (
                <div className="text-[11px] italic text-amber-700 dark:text-amber-400 mb-1 line-clamp-1 md:pr-6">
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
                <>
                    <button
                        type="button"
                        onClick={onStartEdit}
                        className="w-full text-left whitespace-pre-wrap text-slate-800 dark:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 rounded"
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

            <div className={cn('flex items-center gap-1', onGoTo ? 'mt-1' : 'mt-1 md:mt-0')}>
                {onGoTo && (
                    <button
                        type="button"
                        onClick={onGoTo}
                        className="inline-flex min-h-[44px] items-center gap-1 rounded px-1 text-xs font-medium text-slate-500 transition-colors hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 md:py-0.5 dark:text-slate-400 dark:hover:text-primary-400"
                    >
                        <LocateFixed size={12} aria-hidden /> Vai al passo
                    </button>
                )}
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemove(); }}
                    className="ml-auto flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-slate-400 transition-opacity hover:bg-red-50 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 md:absolute md:right-1.5 md:top-1.5 md:ml-0 md:min-h-0 md:min-w-0 md:p-1 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 dark:hover:bg-red-900/20"
                    title="Elimina nota"
                    aria-label="Elimina nota"
                >
                    <Trash2 size={12} aria-hidden />
                </button>
            </div>
        </div>
    );
}
