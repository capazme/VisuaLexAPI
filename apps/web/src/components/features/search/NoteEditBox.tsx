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
}

/**
 * A note's text being edited in place — the note cards' (`NoteCard`): blur or Cmd/Ctrl+Enter saves, Esc cancels;
 * `explicit` for an application's note (`ProposalCard`, `AiNoteEntryReview`), saved only by «Salva» or Enter.
 */
export function NoteEditBox({ value, onChange, onCommit, onCancel, label, explicit = false }: NoteEditBoxProps) {
    const box = (
        <textarea
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
                    onCancel();
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
            <div className="mt-1 flex items-center justify-end gap-1">
                <button
                    type="button"
                    onClick={onCancel}
                    className={cn('min-h-[44px] rounded-md px-3 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800', FOCUS_RING)}
                >
                    Annulla
                </button>
                <button
                    type="button"
                    onClick={onCommit}
                    className={cn('min-h-[44px] rounded-md bg-primary-600 px-3 text-xs font-semibold text-white hover:bg-primary-700', FOCUS_RING)}
                >
                    Salva
                </button>
            </div>
        </div>
    );
}
