import { useId, useState } from 'react';
import { Check, Flag, Pencil, Trash2 } from 'lucide-react';
import type { AiReviewState } from '../../../types';
import { cn } from '../../../lib/utils';

export interface AiReviewControlsProps {
    state: AiReviewState;
    /** The user changed the text: «Validato, modificato da te». */
    edited: boolean;
    /** The application's own version, once the user changed it: «Vedi la versione dell'IA» shows it. */
    original: string | null;
    /** «Cosa non va?», on an item flagged «Da rivedere». */
    reviewComment: string | null;
    /** The checkbox: ticked validates, unticked goes back to «da validare». */
    onValidate: (validated: boolean) => void;
    /** The flag: on marks it «Da rivedere», off goes back to «da validare». */
    onFlag: (flagged: boolean) => void;
    /**
     * The few words of «Cosa non va?», saved as the field is left when changed. An emptied field sends nothing: the
     * server keeps the last words for the second cut, and shows them again.
     */
    onReviewComment: (text: string) => void;
    /** The pencil: the caller opens the note's editing. */
    onEdit: () => void;
    /** The bin: the caller removes the item and offers «Annulla» in its notice. */
    onRemove: () => void;
    /** What the pencil and the bin act on, in their names: «Modifica la nota del passaggio», «Rimuovi il passaggio». */
    editLabel: string;
    removeLabel: string;
}

// 44 px at every width: the card sits in a popover a finger uses as often as a mouse.
const ACTION = 'flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2';

/**
 * What the user does with an item an application wrote (D7b, its note's three states): a real checkbox, «Proposto dall'IA,
 * confermi?», ticked «Validato» with the green tick (or «Validato, modificato da te»); then the flag «Da rivedere», with
 * its short «Cosa non va?» below; the pencil; the bin. Once the text was changed, «Vedi la versione dell'IA» shows the
 * application's own beside it. Each state has its own shape — the tick, the flag, the empty box — never colour alone.
 */
export function AiReviewControls({
    state, edited, original, reviewComment, onValidate, onFlag, onReviewComment, onEdit, onRemove, editLabel, removeLabel,
}: AiReviewControlsProps) {
    const validated = state === 'validated';
    const flagged = state === 'review';
    const [showOriginal, setShowOriginal] = useState(false);
    const originalId = useId();

    return (
        <div>
            {original !== null && (
                <div className="mt-1">
                    <button
                        type="button"
                        aria-expanded={showOriginal}
                        aria-controls={showOriginal ? originalId : undefined}
                        onClick={() => setShowOriginal((v) => !v)}
                        className="inline-flex min-h-[44px] items-center rounded px-0.5 text-xs font-medium text-primary-700 underline underline-offset-2 hover:text-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-300 dark:hover:text-primary-200"
                    >
                        {showOriginal ? "Nascondi la versione dell'IA" : "Vedi la versione dell'IA"}
                    </button>
                    {showOriginal && (
                        <div id={originalId} className="rounded-md border border-dashed border-slate-300 bg-white px-2 py-1.5 dark:border-slate-600 dark:bg-slate-900">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Versione dell'IA</p>
                            <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">{original || '—'}</p>
                        </div>
                    )}
                </div>
            )}
            <div className="mt-1 flex items-center gap-0.5">
                {/* The label is the 44 px target; the input is the checkbox a screen reader and the keyboard reach. */}
                <label className="flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded pr-1">
                    <input type="checkbox" checked={validated} onChange={(e) => onValidate(e.target.checked)} className="peer sr-only" />
                    <span
                        aria-hidden
                        className={cn(
                            'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border-2 bg-white transition-colors motion-reduce:transition-none dark:bg-slate-900',
                            'peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 peer-focus-visible:ring-offset-1 dark:peer-focus-visible:ring-offset-slate-900',
                            validated ? 'border-emerald-600 dark:border-emerald-400' : 'border-slate-500 dark:border-slate-400',
                        )}
                    >
                        {validated && <Check size={14} strokeWidth={3} className="text-emerald-600 dark:text-emerald-400" />}
                    </span>
                    <span className={cn('text-xs font-medium', validated ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300')}>
                        {validated ? (edited ? 'Validato, modificato da te' : 'Validato') : "Proposto dall'IA, confermi?"}
                    </span>
                </label>
                <button
                    type="button"
                    onClick={() => onFlag(!flagged)}
                    aria-pressed={flagged}
                    aria-label="Da rivedere"
                    title="Da rivedere"
                    className={cn(
                        ACTION,
                        'focus-visible:ring-red-500',
                        flagged
                            ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                            : 'text-slate-500 hover:bg-red-50 hover:text-red-700 dark:text-slate-400 dark:hover:bg-red-950/30 dark:hover:text-red-400',
                    )}
                >
                    <Flag size={14} aria-hidden className={cn(flagged && 'fill-current')} />
                </button>
                <button
                    type="button"
                    onClick={onEdit}
                    aria-label={editLabel}
                    title={editLabel}
                    className={cn(ACTION, 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-primary-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100')}
                >
                    <Pencil size={14} aria-hidden />
                </button>
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={removeLabel}
                    title={removeLabel}
                    className={cn(ACTION, 'text-slate-500 hover:bg-red-50 hover:text-red-600 focus-visible:ring-red-500 dark:text-slate-400 dark:hover:bg-red-900/20 dark:hover:text-red-400')}
                >
                    <Trash2 size={14} aria-hidden />
                </button>
            </div>
            {flagged && (
                <div className="mt-1 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 dark:border-red-900/60 dark:bg-red-950/30">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400">
                        <Flag size={12} aria-hidden className="fill-current" /> Da rivedere
                    </p>
                    {/* Drawn again whenever the server's words change (a new flag shows the last ones it kept). */}
                    <ReviewComment key={reviewComment ?? ''} saved={reviewComment} onSave={onReviewComment} />
                </div>
            )}
        </div>
    );
}

/** «Cosa non va?»: a few words, up to the server's 500, saved as the field is left (or on Enter) when changed. */
function ReviewComment({ saved, onSave }: { saved: string | null; onSave: (text: string) => void }) {
    const [comment, setComment] = useState(saved ?? '');
    return (
        <label className="mt-1 block text-xs text-slate-700 dark:text-slate-300">
            Cosa non va?
            <input
                type="text"
                value={comment}
                maxLength={500}
                onChange={(e) => setComment(e.target.value)}
                onBlur={() => {
                    const text = comment.trim();
                    if (text && text !== (saved ?? '')) onSave(text);
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                className="mt-0.5 block min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500/40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
        </label>
    );
}
