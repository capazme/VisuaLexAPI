import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../lib/utils';
import { FOCUS_RING } from '../studia/progress/tokens';

export interface NoteEditBoxProps {
    value: string;
    onChange: (text: string) => void;
    onCommit: () => void;
    onCancel: () => void;
    /** Its name, when nothing around it labels it. */
    label?: string;
    /**
     * Saved only by asking (the notes an application wrote, D7b): «Salva» and «Annulla» under it, Enter saves,
     * Shift+Enter starts a new line, Esc cancels, and leaving the box saves nothing.
     */
    explicit?: boolean;
    /** Explicit: the text differs from the note's, so cancelling asks first («Scartare la modifica?»). */
    dirty?: boolean;
    /** Explicit: something around it wants to close (its popover's X, Esc): the same question, asked now. */
    confirmDiscard?: boolean;
    /** The question asked from outside was answered «Continua»: the editing goes on. */
    onKeep?: () => void;
}

const BUTTON = 'min-h-[44px] rounded-md px-3 text-xs';
const QUIET = cn(BUTTON, 'font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800', FOCUS_RING);
const MAIN = cn(BUTTON, 'bg-primary-600 font-semibold text-white hover:bg-primary-700', FOCUS_RING);

/**
 * A note's text being edited in place — the note cards' (`NoteCard`): blur or Cmd/Ctrl+Enter saves, Esc cancels;
 * `explicit` for an application's note (`ProposalCard`, `AiNoteEntryReview`), saved only by «Salva» or Enter, and a
 * changed text is never dropped without asking.
 */
export function NoteEditBox({
    value, onChange, onCommit, onCancel, label, explicit = false, dirty = false, confirmDiscard = false, onKeep,
}: NoteEditBoxProps) {
    const [asking, setAsking] = useState(false);
    const boxRef = useRef<HTMLTextAreaElement>(null);
    const keepRef = useRef<HTMLButtonElement>(null);
    const showQuestion = explicit && (asking || confirmDiscard);
    // Asked, the focus goes to «Continua»: the safe answer, and the one Enter would press.
    useEffect(() => {
        if (showQuestion) keepRef.current?.focus();
    }, [showQuestion]);

    const cancel = () => {
        if (explicit && dirty) setAsking(true);
        else onCancel();
    };
    const keep = () => {
        setAsking(false);
        onKeep?.();
        boxRef.current?.focus();
    };
    const discard = () => {
        setAsking(false);
        onCancel();
    };

    const box = (
        <textarea
            ref={boxRef}
            autoFocus
            aria-label={label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={explicit ? undefined : onCommit}
            // A phone's Return saves here (it has no Shift+Enter): its key says so.
            enterKeyHint={explicit ? 'done' : undefined}
            onKeyDown={(e) => {
                // A key that confirms or leaves an input method's text is the method's, not the box's (Safari sends
                // Enter after the composition ended, as keyCode 229).
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === 'Escape') {
                    e.preventDefault();
                    // Explicit, Esc cancels the editing only, not the popover around it.
                    if (explicit) e.stopPropagation();
                    cancel();
                }
                if (e.key !== 'Enter') return;
                if (explicit ? !e.shiftKey : e.metaKey || e.ctrlKey) { e.preventDefault(); onCommit(); }
            }}
            rows={Math.max(2, value.split('\n').length)}
            className="w-full resize-none rounded-md border border-amber-500/50 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
        />
    );
    if (!explicit) return box;
    return (
        <div>
            {box}
            {showQuestion ? (
                <div
                    className="mt-1 flex flex-wrap items-center justify-end gap-1"
                    // Esc here is «Continua», never the popover's.
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); keep(); } }}
                >
                    <p role="alert" className="mr-auto text-xs font-medium text-slate-700 dark:text-slate-200">Scartare la modifica?</p>
                    <button ref={keepRef} type="button" onClick={keep} className={QUIET}>Continua</button>
                    <button type="button" onClick={discard} className={cn(BUTTON, 'font-semibold text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30', FOCUS_RING)}>
                        Scarta
                    </button>
                </div>
            ) : (
                <div className="mt-1 flex items-center justify-end gap-1">
                    <button type="button" onClick={cancel} className={QUIET}>Annulla</button>
                    <button type="button" onClick={onCommit} className={MAIN}>Salva</button>
                </div>
            )}
        </div>
    );
}
