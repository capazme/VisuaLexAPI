import { useEffect, useId, useRef, useState, type CSSProperties, type Ref } from 'react';
import { Check, Flag, MoveHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { AiReviewState, Proposal } from '../../../types';
import { cn } from '../../../lib/utils';
import { GLOSS_WORDS } from '../../../constants/glossWords';
import { assistantProposalsStore } from '../../../store/assistantProposals';
import { NoteEditBox } from './NoteEditBox';
import { ReviewComment } from './AiReviewControls';
import type { ProposalActions } from './BlockAnnotationsPopover';

export interface GlossCardProps {
    gloss: Proposal;
    actions: ProposalActions;
    /** Its words are shown in the text (hovered or focused, here or from its sign). */
    active?: boolean;
    /** The pointer or the focus came or went: the reader shows the gloss's words, or stops. */
    onShowPassage?: (show: boolean) => void;
    /** «Sposta», when the caller has to do something first (the popover closes); else `actions.move`. */
    onMove?: () => void;
    /** «Rimuovi», when the caller has to do something after (the popover's focus); else `actions.remove`. */
    onRemove?: () => void;
    /** Esc on the card, beside the text: the focus goes back to its block's sign (a field's own Esc is the field's). */
    onEscape?: () => void;
    /** Whether its note is being edited, and changed: a popover then keeps open on an outside press, and asks. */
    onDraftState?: (state: 'none' | 'clean' | 'dirty') => void;
    /** A popover wants to close over a changed draft: the card asks «Scartare la modifica?». */
    closeRequested?: boolean;
    onCloseAnswer?: (discarded: boolean) => void;
    /** The card's root, which the reader focuses from the block's sign. */
    ref?: Ref<HTMLElement>;
    className?: string;
    /** Its place in the column (a transform). */
    style?: CSSProperties;
}

/** The state's own shape (never colour alone), as on the block's sign and the row's light. */
function StateMark({ state }: { state: AiReviewState }) {
    if (state === 'validated') return <Check size={13} strokeWidth={3} aria-hidden className="shrink-0" />;
    if (state === 'review') return <Flag size={12} aria-hidden className="shrink-0 fill-current" />;
    return <span aria-hidden className="h-3 w-3 shrink-0 rounded-full border-[1.5px] border-dashed border-current" />;
}

const STATE_TONE: Record<AiReviewState, string> = {
    proposed: 'text-amber-800 dark:text-amber-300',
    review: 'text-red-700 dark:text-red-400',
    validated: 'text-emerald-700 dark:text-emerald-400',
};

// 44 px on a touch screen (the phone's popover, a tablet's column); a computer's pointer has the compact row.
const ACTION = cn(
    'inline-flex min-h-[44px] items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors motion-reduce:transition-none',
    '[@media(pointer:fine)]:min-h-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
);
const QUIET = 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100';
const LINK = 'inline-flex min-h-[44px] items-center rounded px-0.5 text-xs font-medium text-primary-700 underline underline-offset-2 hover:text-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 [@media(pointer:fine)]:min-h-7 dark:text-primary-300 dark:hover:text-primary-200';

/**
 * An application's gloss on a passage (D8), as a word processor's comment: its state, the passage it is on, its text,
 * then what the user does with it — «Valida», «Da rivedere» (with its optional «Cosa non va?»), «Modifica» (the text
 * edited in place, saved only by «Salva» or Enter, never emptied: the server refuses an empty gloss), «Sposta» (the
 * passage's boundaries, `MoveProposalBar`) and «Rimuovi» (the caller's notice offers «Annulla»). Hovering it or
 * focusing anything in it shows its words in the text (`onShowPassage`). The same card beside the text on a wide reader
 * and in the block's popover on a narrow one.
 */
export function GlossCard({
    gloss, actions, active = false, onShowPassage, onMove, onRemove, onEscape, onDraftState, closeRequested = false, onCloseAnswer, ref, className, style,
}: GlossCardProps) {
    const titleId = useId();
    const originalId = useId();
    const passageId = useId();
    const quoteId = useId();
    const note = gloss.note;
    const state: AiReviewState = note?.state ?? 'proposed';
    const edited = note?.edited ?? false;
    const text = note?.text.trim() ?? '';
    const validated = state === 'validated';
    const flagged = state === 'review';
    const busy = assistantProposalsStore((s) => !!s.busy[gloss.id]);
    const [draft, setDraft] = useState<string | null>(null);
    const [showOriginal, setShowOriginal] = useState(false);
    const [showPassage, setShowPassage] = useState(false);

    const draftState = draft === null ? 'none' : draft.trim() !== text ? 'dirty' : 'clean';
    const reportRef = useRef(onDraftState);
    useEffect(() => { reportRef.current = onDraftState; });
    useEffect(() => { reportRef.current?.(draftState); }, [draftState]);
    useEffect(() => () => reportRef.current?.('none'), []);

    // Said once the server's answer changes the state, never as the card first appears.
    const words = GLOSS_WORDS.state(state, edited);
    const [said, setSaid] = useState({ words, announce: '' });
    if (said.words !== words) setSaid({ words, announce: words });

    // The editing box gone (saved or not), the focus goes back to «Modifica».
    const editRef = useRef<HTMLButtonElement>(null);
    const wasEditing = useRef(false);
    useEffect(() => {
        if (wasEditing.current && draft === null) editRef.current?.focus();
        wasEditing.current = draft !== null;
    }, [draft]);

    // The words in the text while the pointer is over the card or the focus inside it.
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const showRef = useRef(onShowPassage);
    useEffect(() => { showRef.current = onShowPassage; });
    const shown = hovered || focused;
    useEffect(() => { showRef.current?.(shown); }, [shown]);
    useEffect(() => () => { showRef.current?.(false); }, []);

    const commit = () => {
        const next = draft?.trim() ?? '';
        // Never emptied (a gloss is its text: the bin removes it); unchanged, nothing is sent.
        if (next && next !== text) actions.editNote(gloss.id, next);
        setDraft(null);
    };

    return (
        <article
            ref={ref as Ref<HTMLElement>}
            tabIndex={-1}
            aria-labelledby={titleId}
            aria-describedby={quoteId}
            data-gloss={gloss.id}
            style={style}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
            onKeyDown={(e) => {
                // The text box's Esc cancels its editing and marks the key taken: only a free Esc leaves the card.
                if (e.key !== 'Escape' || e.defaultPrevented || !onEscape) return;
                e.preventDefault();
                onEscape();
            }}
            className={cn(
                'rounded-lg border bg-white px-3 py-2 font-sans text-sm shadow-sm outline-none transition-[border-color,box-shadow] motion-reduce:transition-none dark:bg-slate-900',
                active ? 'border-primary-500 ring-1 ring-primary-500 dark:border-primary-400 dark:ring-primary-400' : 'border-slate-200 dark:border-slate-700',
                'focus-visible:ring-2 focus-visible:ring-primary-500',
                className,
            )}
        >
            <h4 id={titleId} className={cn('flex items-center gap-1.5 text-xs font-semibold', STATE_TONE[state])}>
                <StateMark state={state} />
                <span className="sr-only">{GLOSS_WORDS.one}: </span>
                {words}
            </h4>
            <span className="sr-only" role="status">{said.announce}</span>
            {/* The words it is on, one line: enough to tell two cards apart where one was pushed down. */}
            <p id={quoteId} className="mt-1 truncate font-serif text-[13px] italic text-slate-600 dark:text-slate-400" title={gloss.text}>
                &ldquo;{gloss.text}&rdquo;
            </p>
            {draft !== null ? (
                <div className="mt-1.5">
                    <NoteEditBox
                        value={draft}
                        onChange={setDraft}
                        onCommit={commit}
                        onCancel={() => {
                            setDraft(null);
                            if (closeRequested) onCloseAnswer?.(true);
                        }}
                        label={GLOSS_WORDS.noteLabel}
                        explicit
                        dirty={draftState === 'dirty'}
                        confirmDiscard={closeRequested}
                        onKeep={() => onCloseAnswer?.(false)}
                    />
                </div>
            ) : (
                <p className="mt-1.5 whitespace-pre-wrap text-slate-800 [overflow-wrap:anywhere] dark:text-slate-200">{text}</p>
            )}
            {(edited || gloss.rangeEdited) && (
                <div className="mt-1 flex flex-wrap gap-x-3">
                    {edited && (
                        <button type="button" aria-expanded={showOriginal} aria-controls={showOriginal ? originalId : undefined} onClick={() => setShowOriginal((v) => !v)} className={LINK}>
                            {showOriginal ? "Nascondi la versione dell'IA" : "Vedi la versione dell'IA"}
                        </button>
                    )}
                    {gloss.rangeEdited && (
                        <button type="button" aria-expanded={showPassage} aria-controls={showPassage ? passageId : undefined} onClick={() => setShowPassage((v) => !v)} className={LINK}>
                            {showPassage ? "Nascondi il passaggio dell'IA" : "Vedi il passaggio dell'IA"}
                        </button>
                    )}
                </div>
            )}
            {showOriginal && edited && (
                <div id={originalId} className="mt-1 rounded-md border border-dashed border-slate-300 px-2 py-1.5 dark:border-slate-600">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Versione dell'IA</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">{note?.assistantText || '—'}</p>
                </div>
            )}
            {showPassage && gloss.rangeEdited && (
                <div id={passageId} className="mt-1 rounded-md border border-dashed border-slate-300 px-2 py-1.5 dark:border-slate-600">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Passaggio dell'IA</p>
                    <p className="mt-0.5 line-clamp-4 text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">&ldquo;{gloss.assistantRange.text}&rdquo;</p>
                </div>
            )}
            <div className="-mx-1.5 mt-1.5 flex flex-wrap items-center gap-0.5">
                <button
                    type="button"
                    aria-pressed={validated}
                    aria-disabled={busy || undefined}
                    onClick={() => { if (!busy) actions.validate(gloss.id, !validated); }}
                    className={cn(
                        ACTION,
                        busy && 'cursor-wait opacity-60',
                        validated
                            ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : 'text-emerald-800 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30',
                    )}
                >
                    <Check size={13} strokeWidth={2.5} aria-hidden /> Valida
                </button>
                <button
                    type="button"
                    aria-pressed={flagged}
                    aria-disabled={busy || undefined}
                    onClick={() => { if (!busy) actions.flag(gloss.id, !flagged); }}
                    className={cn(
                        ACTION,
                        busy && 'cursor-wait opacity-60',
                        flagged
                            ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                            : 'text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30',
                    )}
                >
                    <Flag size={12} aria-hidden className={cn(flagged && 'fill-current')} /> Da rivedere
                </button>
                <button
                    ref={editRef}
                    type="button"
                    onClick={() => setDraft(text)}
                    disabled={draft !== null}
                    className={cn(ACTION, QUIET, 'disabled:opacity-50')}
                >
                    <Pencil size={12} aria-hidden /> Modifica
                </button>
                {actions.move && (
                    <button type="button" onClick={onMove ?? (() => actions.move!(gloss.id))} className={cn(ACTION, QUIET)}>
                        <MoveHorizontal size={13} aria-hidden /> Sposta
                    </button>
                )}
                <button
                    type="button"
                    onClick={onRemove ?? (() => actions.remove(gloss.id))}
                    className={cn(ACTION, 'text-slate-700 hover:bg-red-50 hover:text-red-700 dark:text-slate-300 dark:hover:bg-red-950/30 dark:hover:text-red-400')}
                >
                    <Trash2 size={12} aria-hidden /> Rimuovi
                </button>
            </div>
            {flagged && (
                <div className="mt-1 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 dark:border-red-900/60 dark:bg-red-950/30">
                    {/* Drawn again whenever the server's words change (a new flag shows the last ones it kept). */}
                    <ReviewComment key={note?.reviewComment ?? ''} saved={note?.reviewComment ?? null} onSave={(t) => actions.comment(gloss.id, t)} />
                </div>
            )}
        </article>
    );
}
