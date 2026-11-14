import { useEffect, useId, useRef, useState, type CSSProperties, type Ref } from 'react';
import { MessageCircle, Pencil, Trash2 } from 'lucide-react';
import type { Annotation, ArticleDiscussionPassageSummary } from '../../../types';
import { cn } from '../../../lib/utils';
import { AttributionChip } from '../bulletin/AttributionChip';
import { NoteEditBox } from './NoteEditBox';
import { scrollToMiddle } from '../../../utils/scrollParent';

/** The card's frame, as an application's gloss's (`GlossCard`): a comment of a word processor. */
const CARD = cn(
    'rounded-lg border border-slate-200 bg-white px-3 py-2 font-sans text-sm shadow-sm outline-none dark:border-slate-700 dark:bg-slate-900',
    'focus-visible:ring-2 focus-visible:ring-primary-500',
);
// 44 px on a touch screen (a phone's sheet, a tablet's column); a computer's pointer has the compact row.
const ACTION = cn(
    'inline-flex min-h-[44px] items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors motion-reduce:transition-none',
    '[@media(pointer:fine)]:min-h-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
);
const QUIET = 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100';
const DANGER = 'text-slate-700 hover:bg-red-50 hover:text-red-700 dark:text-slate-300 dark:hover:bg-red-950/30 dark:hover:text-red-400';

/** The words a card is on, one line: enough to tell two cards apart where one was pushed down. */
function Quote({ id, text, tone = 'note' }: { id: string; text: string; tone?: 'note' | 'thread' }) {
    return (
        <p
            id={id}
            title={text}
            className={cn(
                'truncate font-serif text-[13px] italic',
                tone === 'note' ? 'text-amber-800 dark:text-amber-300' : 'text-primary-700 dark:text-primary-300',
            )}
        >
            &ldquo;{text}&rdquo;
        </p>
    );
}

/** Esc on a card (not a field's own, which the field takes): back to where it came from, its block's sign. */
const escapeTo = (onEscape?: () => void) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !onEscape) return;
    e.preventDefault();
    onEscape();
};

export interface NoteMarginCardProps {
    note: Annotation;
    onUpdate: (id: string, text: string) => void;
    /** «Rimuovi»: the store's removal, its notification offering «Annulla». */
    onRemove: () => void;
    onEscape?: () => void;
    /** Whether its text is being edited, and changed: the sheet around it then asks before it closes. */
    onDraftState?: (state: 'none' | 'clean' | 'dirty') => void;
    /** The sheet wants to close over a changed text: the card asks «Scartare la modifica?». */
    closeRequested?: boolean;
    onCloseAnswer?: (discarded: boolean) => void;
    ref?: Ref<HTMLElement>;
    className?: string;
    style?: CSSProperties;
}

/**
 * A personal note beside the text (A4 §6), as a word processor's comment: the words it is on, its text, then «Modifica»
 * (the text edited in place, saved by «Salva» or Enter, never emptied — the bin removes a note) and «Rimuovi». The
 * same card in the column beside the text and in a block's sheet.
 */
export function NoteMarginCard({
    note, onUpdate, onRemove, onEscape, onDraftState, closeRequested = false, onCloseAnswer, ref, className, style,
}: NoteMarginCardProps) {
    const titleId = useId();
    const quoteId = useId();
    const [draft, setDraft] = useState<string | null>(null);
    const text = note.text;

    const draftState = draft === null ? 'none' : draft.trim() !== text.trim() ? 'dirty' : 'clean';
    const reportRef = useRef(onDraftState);
    useEffect(() => { reportRef.current = onDraftState; });
    useEffect(() => { reportRef.current?.(draftState); }, [draftState]);
    useEffect(() => () => reportRef.current?.('none'), []);

    // The editing box gone (saved or not), the focus goes back to «Modifica».
    const editRef = useRef<HTMLButtonElement>(null);
    const wasEditing = useRef(false);
    useEffect(() => {
        if (wasEditing.current && draft === null) editRef.current?.focus();
        wasEditing.current = draft !== null;
    }, [draft]);

    const commit = () => {
        const next = draft?.trim() ?? '';
        if (next && next !== text.trim()) onUpdate(note.id, next);
        setDraft(null);
    };

    return (
        <article
            ref={ref as Ref<HTMLElement>}
            tabIndex={-1}
            aria-labelledby={titleId}
            aria-describedby={note.anchorText ? quoteId : undefined}
            data-note={note.id}
            style={style}
            onKeyDown={escapeTo(onEscape)}
            className={cn(CARD, className)}
        >
            <h4 id={titleId} className="sr-only">Nota personale</h4>
            {note.anchorText && <Quote id={quoteId} text={note.anchorText} />}
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
                        label="Testo della nota"
                        explicit
                        dirty={draftState === 'dirty'}
                        confirmDiscard={closeRequested}
                        onKeep={() => onCloseAnswer?.(false)}
                    />
                </div>
            ) : (
                <p className="mt-1 whitespace-pre-wrap text-slate-800 [overflow-wrap:anywhere] dark:text-slate-200">{text}</p>
            )}
            {note.sourceSuggestionId && (
                <div className="mt-1">
                    <AttributionChip author={note.originalAuthor} />
                </div>
            )}
            <div className="-mx-1.5 mt-1 flex flex-wrap items-center gap-0.5">
                <button ref={editRef} type="button" onClick={() => setDraft(text)} disabled={draft !== null} className={cn(ACTION, QUIET, 'disabled:opacity-50')}>
                    <Pencil size={12} aria-hidden /> Modifica
                </button>
                <button type="button" onClick={onRemove} className={cn(ACTION, DANGER)}>
                    <Trash2 size={12} aria-hidden /> Rimuovi
                </button>
            </div>
        </article>
    );
}

export interface NoteDraftCardProps {
    /** The words the new note is on. */
    text: string;
    /** What is written in it: kept by the column, so it survives the move to a sheet and back. */
    value: string;
    onChange: (text: string) => void;
    onSave: (text: string) => void;
    onCancel: () => void;
    /** It has its place in the column: its field takes the focus then, never before (the page would scroll). */
    placed: boolean;
    ref?: Ref<HTMLElement>;
    className?: string;
    style?: CSSProperties;
}

/**
 * The editor of a new note (A4 §6), at its words' height in the column beside the text (or in a sheet from the bottom,
 * `NoteComposerSheet`): the words, the field (its focus at once), «Salva» or Enter, «Annulla» or Esc — a text written
 * is never dropped without asking («Scartare la modifica?»). An empty note is not saved.
 */
export function NoteDraftCard({ text, value, onChange, onSave, onCancel, placed, ref, className, style }: NoteDraftCardProps) {
    const titleId = useId();
    const quoteId = useId();
    const fieldRef = useRef<HTMLDivElement>(null);
    // Its place known, the field takes the focus; the card is brought into view only if the column opening moved it
    // out of sight (the text reflowed as the column took its room).
    useEffect(() => {
        if (!placed) return;
        fieldRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
        const card = fieldRef.current?.closest('article');
        const box = card?.getBoundingClientRect();
        if (card && box && (box.top < 0 || box.bottom > window.innerHeight)) scrollToMiddle(card);
    }, [placed]);
    return (
        <article
            ref={ref as Ref<HTMLElement>}
            tabIndex={-1}
            aria-labelledby={titleId}
            aria-describedby={quoteId}
            data-note-draft=""
            style={style}
            className={cn(CARD, 'border-amber-300 dark:border-amber-700', className)}
        >
            <h4 id={titleId} className="text-xs font-semibold text-slate-700 dark:text-slate-300">Nuova nota</h4>
            <Quote id={quoteId} text={text} />
            <div ref={fieldRef} className="mt-1.5">
                <NoteDraftField value={value} onChange={onChange} onSave={onSave} onCancel={onCancel} autoFocus={false} />
            </div>
        </article>
    );
}

/** A new note's field: the card's and the sheet's. */
export function NoteDraftField({ value, onChange, onSave, onCancel, autoFocus = true, confirmDiscard = false, onKeep }: {
    value: string;
    onChange: (text: string) => void;
    onSave: (text: string) => void;
    onCancel: () => void;
    autoFocus?: boolean;
    /** Something around it wants to close over a text written: «Scartare la modifica?», asked now. */
    confirmDiscard?: boolean;
    onKeep?: () => void;
}) {
    return (
        <NoteEditBox
            autoFocus={autoFocus}
            confirmDiscard={confirmDiscard}
            onKeep={onKeep}
            value={value}
            onChange={onChange}
            onCommit={() => {
                const trimmed = value.trim();
                if (trimmed) onSave(trimmed);
                else onCancel();
            }}
            onCancel={onCancel}
            label="Testo della nota"
            explicit
            dirty={value.trim() !== ''}
        />
    );
}

export interface ThreadCardProps {
    thread: ArticleDiscussionPassageSummary;
    /** Fingerprint of the text on screen, to tell a discussion opened on another text. */
    currentTextHash?: string | null;
    onOpen: () => void;
    onEscape?: () => void;
    ref?: Ref<HTMLElement>;
    className?: string;
    style?: CSSProperties;
}

/** A passage discussion with colleagues (a «glossa»): its words, title, author and replies, opened in its panel. */
export function ThreadCard({ thread, currentTextHash, onOpen, onEscape, ref, className, style }: ThreadCardProps) {
    const titleId = useId();
    const quoteId = useId();
    const isTextDifferent = Boolean(thread.textHash) && Boolean(currentTextHash) && thread.textHash !== currentTextHash;
    const repliesLabel = thread.commentCount === 1 ? '1 risposta' : `${thread.commentCount} risposte`;
    return (
        <article
            ref={ref as Ref<HTMLElement>}
            tabIndex={-1}
            aria-labelledby={titleId}
            aria-describedby={quoteId}
            data-thread={thread.id}
            style={style}
            onKeyDown={escapeTo(onEscape)}
            className={cn(CARD, className)}
        >
            <h4 id={titleId} className="sr-only">Glossa{thread.title ? `: ${thread.title}` : ''}</h4>
            <Quote id={quoteId} text={thread.passage.quote} tone="thread" />
            {thread.title ? <p className="mt-1 font-medium text-slate-800 dark:text-slate-200">{thread.title}</p> : null}
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                @{thread.user.username} &middot; {repliesLabel}
            </p>
            {isTextDifferent && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Il testo è cambiato da quando è stata aperta</p>
            )}
            <div className="-mx-1.5 mt-1 flex items-center">
                <button type="button" onClick={onOpen} className={cn(ACTION, QUIET)}>
                    <MessageCircle size={12} aria-hidden /> Apri glossa
                </button>
            </div>
        </article>
    );
}
