export interface NoteEditBoxProps {
    value: string;
    onChange: (text: string) => void;
    onCommit: () => void;
    onCancel: () => void;
    /** Its name, when nothing around it labels it. */
    label?: string;
}

/**
 * A note's text being edited in place — the note cards' (`NoteCard`) and a proposed passage's (`ProposalCard`): blur or
 * Cmd/Ctrl+Enter saves, Esc cancels.
 */
export function NoteEditBox({ value, onChange, onCommit, onCancel, label }: NoteEditBoxProps) {
    return (
        <textarea
            autoFocus
            aria-label={label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onCommit}
            onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onCommit(); }
            }}
            rows={Math.max(2, value.split('\n').length)}
            className="w-full resize-none rounded-md border border-amber-500/50 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
        />
    );
}
