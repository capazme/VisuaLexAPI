import type { Ref } from 'react';
import { Highlighter, StickyNote } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface NotesHighlightsButtonsProps {
    notesCount: number;
    highlightsCount: number;
    isNotesOpen: boolean;
    isHighlightsOpen: boolean;
    notesButtonRef?: Ref<HTMLButtonElement | null>;
    highlightsButtonRef?: Ref<HTMLButtonElement | null>;
    onToggleNotes: () => void;
    onToggleHighlights: () => void;
    /** Set when the reader may not annotate (a past text): both buttons are off, with this as the reason. */
    lockedReason?: string;
}

// A switched-off tool keeps its name and gains the reason in its tooltip.
const tip = (name: string, reason?: string) => (reason ? `${name} — ${reason}` : name);

/**
 * The notes and highlights buttons of the reading toolbar, shared by the article's
 * (`ReadingToolbar`) and the decision's (`DecisionReadingToolbar`): one look, one behaviour.
 */
export function NotesHighlightsButtons({
    notesCount, highlightsCount, isNotesOpen, isHighlightsOpen, notesButtonRef, highlightsButtonRef,
    onToggleNotes, onToggleHighlights, lockedReason,
}: NotesHighlightsButtonsProps) {
    const size = 'inline-flex items-center justify-center min-h-[44px] min-w-[44px] p-2.5 md:min-h-0 md:min-w-0 md:p-1.5';
    const notesName = isNotesOpen ? 'Chiudi note' : 'Apri note';
    const highlightsName = isHighlightsOpen ? 'Chiudi evidenziazioni' : 'Gestisci evidenziazioni';
    return (
        <>
            <button
                ref={notesButtonRef}
                onClick={onToggleNotes}
                aria-expanded={isNotesOpen}
                aria-haspopup="dialog"
                aria-label={notesName}
                className={cn(size, "rounded-md transition-colors relative",
                    isNotesOpen
                        ? "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400"
                        : notesCount > 0
                            ? "text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                            : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-amber-500"
                )}
                title={tip(notesName, lockedReason)}
                disabled={Boolean(lockedReason)}
            >
                <StickyNote size={16} aria-hidden />
                {notesCount > 0 && (
                    <span aria-hidden className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-amber-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                        {notesCount}
                    </span>
                )}
            </button>
            <button
                ref={highlightsButtonRef}
                onClick={onToggleHighlights}
                aria-expanded={isHighlightsOpen}
                aria-haspopup="dialog"
                aria-label={highlightsName}
                className={cn(size, "rounded-md transition-colors relative",
                    isHighlightsOpen
                        ? "bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400"
                        : highlightsCount > 0
                            ? "text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                            : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-purple-500"
                )}
                title={tip(highlightsName, lockedReason)}
                disabled={Boolean(lockedReason)}
            >
                <Highlighter size={16} aria-hidden />
                {highlightsCount > 0 && (
                    <span aria-hidden className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-purple-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                        {highlightsCount}
                    </span>
                )}
            </button>
        </>
    );
}
