import { LocateFixed, Trash2 } from 'lucide-react';
import type { Annotation } from '../../../types';
import { cn } from '../../../lib/utils';
import { AttributionChip } from '../bulletin/AttributionChip';
import { retiredSectionLabel } from '../../../utils/articleAnnotations';
import { NoteEditBox } from './NoteEditBox';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';

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
 * there, at a 44 px target, below it: a touch screen has no hover. A note on a section no longer shown
 * (the old Brocardi Ratio and Spiegazione) says so above its quote, which is not the article's text.
 */
export function NoteCard({ note, isEditing, editingText, onStartEdit, onChangeEdit, onCommitEdit, onCancelEdit, onRemove, onGoTo }: NoteCardProps) {
    const retired = retiredSectionLabel(note.articleId);
    return (
        <div className="group relative rounded-[8px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-2.5 text-sm">
            {retired && (
                <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1 md:pr-6">{retired}</div>
            )}
            {note.anchorText && (
                <div className="text-[11px] italic text-amber-700 dark:text-amber-400 mb-1 line-clamp-1 md:pr-6">
                    &ldquo;{note.anchorText}&rdquo;
                </div>
            )}

            {isEditing ? (
                <NoteEditBox value={editingText} onChange={onChangeEdit} onCommit={onCommitEdit} onCancel={onCancelEdit} />
            ) : (
                <>
                    {/* bare-button: the note's own text, pressed to edit it in place. */}
                    <button
                        type="button"
                        onClick={onStartEdit}
                        className="w-full text-left whitespace-pre-wrap text-slate-800 dark:text-slate-200 focus:outline-none rounded-md"
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
                    <Button type="button" variant="link" onClick={onGoTo} icon={<LocateFixed size={12} aria-hidden />} className="gap-1">
                        Vai al passo
                    </Button>
                )}
                <IconButton
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); onRemove(); }}
                    title="Elimina nota"
                    aria-label="Elimina nota"
                    icon={<Trash2 aria-hidden />}
                    className="ml-auto text-slate-400 hover:bg-red-50 hover:text-red-500 md:absolute md:right-1.5 md:top-1.5 md:ml-0 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 dark:hover:bg-red-900/20"
                />
            </div>
        </div>
    );
}
