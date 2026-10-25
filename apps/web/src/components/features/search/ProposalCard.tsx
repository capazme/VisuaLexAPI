import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Highlight, HighlightProposal } from '../../../types';
import { getHighlightSwatch } from '../../../utils/highlightColors';
import { AiReviewControls } from './AiReviewControls';
import { NoteEditBox } from './NoteEditBox';

export interface ProposalCardProps {
    highlight: Highlight & { proposal: HighlightProposal };
    onValidate: (validated: boolean) => void;
    onFlag: (flagged: boolean) => void;
    onReviewComment: (text: string) => void;
    /** The passage's note saved with the pencil: the caller keeps the application's own and validates it. */
    onEditNote: (text: string) => void;
    /** The bin: the caller removes the passage and offers «Annulla» in its notice. */
    onRemove: () => void;
}

/**
 * A passage an application proposed on a dossier entry (D7b): its colour as a stripe, its words, the note on it, then
 * what the user does with it (`AiReviewControls`). The pencil edits the note in place, as the note cards do
 * (`NoteEditBox`); a saved change makes the passage «Validato, modificato da te».
 */
export function ProposalCard({ highlight, onValidate, onFlag, onReviewComment, onEditNote, onRemove }: ProposalCardProps) {
    const { proposal } = highlight;
    const note = proposal.note?.trim() ?? '';
    const [draft, setDraft] = useState<string | null>(null);
    const commit = () => {
        const text = draft?.trim() ?? '';
        // As a note's: only a changed, non-empty text is saved.
        if (text && text !== note) onEditNote(text);
        setDraft(null);
    };
    return (
        <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3.5 pr-1 text-sm dark:border-slate-700 dark:bg-slate-800/50">
            <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: getHighlightSwatch(highlight.color) }} />
            <p className="line-clamp-3 pr-1.5 text-slate-800 dark:text-slate-200">&ldquo;{highlight.text}&rdquo;</p>
            {draft !== null ? (
                <div className="mt-1.5 pr-1.5">
                    <NoteEditBox value={draft} onChange={setDraft} onCommit={commit} onCancel={() => setDraft(null)} label="Nota del passaggio" />
                </div>
            ) : note && (
                <p className="mt-1.5 flex items-start gap-1.5 pr-1.5 text-slate-700 dark:text-slate-300">
                    <Sparkles size={12} aria-hidden className="mt-1 shrink-0 text-slate-500 dark:text-slate-400" />
                    <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{note}</span>
                </p>
            )}
            <AiReviewControls
                state={proposal.state}
                edited={proposal.originalNote !== null}
                original={proposal.originalNote}
                reviewComment={proposal.reviewComment}
                onValidate={onValidate}
                onFlag={onFlag}
                onReviewComment={onReviewComment}
                onEdit={() => setDraft(note)}
                onRemove={onRemove}
                editLabel="Modifica la nota del passaggio"
                removeLabel="Rimuovi il passaggio"
            />
        </div>
    );
}
