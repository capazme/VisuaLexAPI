import { useState } from 'react';
import { Sparkles, Trash2 } from 'lucide-react';
import type { Highlight, HighlightProposal } from '../../../types';
import { getHighlightSwatch } from '../../../utils/highlightColors';
import { AiReviewControls } from './AiReviewControls';
import { NoteEditBox } from './NoteEditBox';
import { assistantProposalsStore } from '../../../store/assistantProposals';

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
 * what the user does with the note (`AiReviewControls`): the note has the state, not the highlight. The pencil edits the note in place, as the note cards do (`NoteEditBox`); a saved
 * change makes it «Validato, modificato da te». A passage with no note is a mark of known origin: «Evidenziato
 * dall'IA» and the bin, nothing to validate.
 */
export function ProposalCard({ highlight, onValidate, onFlag, onReviewComment, onEditNote, onRemove }: ProposalCardProps) {
    const { proposal } = highlight;
    const aiNote = proposal.note;
    const note = aiNote?.text.trim() ?? '';
    const [draft, setDraft] = useState<string | null>(null);
    const busy = assistantProposalsStore((s) => !!s.busy[highlight.id]);
    const commit = () => {
        const text = draft?.trim() ?? '';
        // As a note's: only a changed, non-empty text is saved.
        if (text && text !== note) onEditNote(text);
        setDraft(null);
    };
    if (!aiNote) {
        return (
            <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 py-1 pl-3.5 pr-1 text-sm dark:border-slate-700 dark:bg-slate-800/50">
                <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: getHighlightSwatch(highlight.color) }} />
                <p className="line-clamp-3 pr-1.5 pt-1 text-slate-800 dark:text-slate-200">&ldquo;{highlight.text}&rdquo;</p>
                <div className="flex items-center gap-1">
                    <p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                        <Sparkles size={12} aria-hidden className="shrink-0" /> Evidenziato dall'IA
                    </p>
                    <button
                        type="button"
                        onClick={onRemove}
                        aria-label="Rimuovi il passaggio"
                        title="Rimuovi il passaggio"
                        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 motion-reduce:transition-none dark:text-slate-400 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                    >
                        <Trash2 size={14} aria-hidden />
                    </button>
                </div>
            </div>
        );
    }
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
                state={aiNote.state}
                edited={aiNote.edited}
                original={aiNote.edited ? aiNote.assistantText : null}
                reviewComment={aiNote.reviewComment}
                onValidate={onValidate}
                onFlag={onFlag}
                onReviewComment={onReviewComment}
                onEdit={() => setDraft(note)}
                onRemove={onRemove}
                editLabel="Modifica la nota del passaggio"
                removeLabel="Rimuovi il passaggio"
                busy={busy}
                editing={draft !== null}
            />
        </div>
    );
}
