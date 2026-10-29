import { useEffect, useId, useRef, useState } from 'react';
import { MoveHorizontal, Sparkles, Trash2 } from 'lucide-react';
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
    /** «Sposta l'evidenziazione»: the reader asks for the new words (absent where it cannot). */
    onMove?: () => void;
    /** Whether its note is being edited, and changed: the popover then keeps open on an outside press, and asks. */
    onDraftState?: (state: 'none' | 'clean' | 'dirty') => void;
    /** The popover wants to close over a changed draft: the card asks «Scartare la modifica?». */
    closeRequested?: boolean;
    /** The answer: discarded (the popover may close) or kept (it stays). */
    onCloseAnswer?: (discarded: boolean) => void;
}

/**
 * A passage an application proposed on a dossier entry (D7b): its colour as a stripe, its words, the note on it, then
 * what the user does with the note (`AiReviewControls`): the note has the state, not the highlight. The pencil edits the note in place, as the note cards do (`NoteEditBox`); a saved
 * change makes it «Validato, modificato da te». A passage with no note is a mark of known origin: «Evidenziato
 * dall'IA» and the bin, nothing to validate.
 */
export function ProposalCard({
    highlight, onValidate, onFlag, onReviewComment, onEditNote, onRemove, onMove, onDraftState, closeRequested = false, onCloseAnswer,
}: ProposalCardProps) {
    const { proposal } = highlight;
    const aiNote = proposal.note;
    const note = aiNote?.text.trim() ?? '';
    const [draft, setDraft] = useState<string | null>(null);
    const draftState = draft === null ? 'none' : draft.trim() !== note ? 'dirty' : 'clean';
    // The latest callback, so a new function each render reports nothing again.
    const reportRef = useRef(onDraftState);
    useEffect(() => { reportRef.current = onDraftState; });
    useEffect(() => { reportRef.current?.(draftState); }, [draftState]);
    // Gone with its card (removed, the popover closed): no draft left behind in the popover's count.
    useEffect(() => () => reportRef.current?.('none'), []);
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
                <PassageBounds originalText={proposal.originalText} onMove={onMove} />
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
            <PassageBounds originalText={proposal.originalText} onMove={onMove} />
            {draft !== null ? (
                <div className="mt-1.5 pr-1.5">
                    <NoteEditBox
                        value={draft}
                        onChange={setDraft}
                        onCommit={commit}
                        onCancel={() => {
                            setDraft(null);
                            if (closeRequested) onCloseAnswer?.(true);
                        }}
                        label="Nota del passaggio"
                        explicit
                        dirty={draftState === 'dirty'}
                        confirmDiscard={closeRequested}
                        onKeep={() => onCloseAnswer?.(false)}
                    />
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

const LINK = 'inline-flex min-h-[44px] items-center gap-1.5 rounded px-0.5 text-xs font-medium text-primary-700 hover:text-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-300 dark:hover:text-primary-200';

/**
 * The passage's boundaries: «Sposta l'evidenziazione», which has the user select its new words in the reader, and, once
 * they were moved, the words the application had marked (the server keeps them). Moving them changes no state.
 */
function PassageBounds({ originalText, onMove }: { originalText?: string; onMove?: () => void }) {
    const [showOriginal, setShowOriginal] = useState(false);
    const originalId = useId();
    if (!onMove && originalText === undefined) return null;
    return (
        <div className="pr-1.5">
            <div className="flex flex-wrap items-center gap-x-3">
                {onMove && (
                    <button type="button" onClick={onMove} className={LINK}>
                        <MoveHorizontal size={14} aria-hidden /> Sposta l'evidenziazione
                    </button>
                )}
                {originalText !== undefined && (
                    <button
                        type="button"
                        aria-expanded={showOriginal}
                        aria-controls={showOriginal ? originalId : undefined}
                        onClick={() => setShowOriginal((v) => !v)}
                        className={`${LINK} underline underline-offset-2`}
                    >
                        {showOriginal ? "Nascondi l'evidenziazione dell'IA" : "Vedi l'evidenziazione dell'IA"}
                    </button>
                )}
            </div>
            {showOriginal && originalText !== undefined && (
                <div id={originalId} className="rounded-md border border-dashed border-slate-300 bg-white px-2 py-1.5 dark:border-slate-600 dark:bg-slate-900">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Evidenziazione dell'IA</p>
                    <p className="mt-0.5 line-clamp-4 text-sm text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">&ldquo;{originalText}&rdquo;</p>
                </div>
            )}
        </div>
    );
}
