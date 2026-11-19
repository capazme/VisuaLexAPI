import type { Ref } from 'react';
import { Highlighter, StickyNote } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';

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
    /**
     * The article's reading row (R3): each button with its word, «Note» and «Evidenziazioni», and the count beside it,
     * in the row's quiet, neutral look. Without it, the icons with a badge (the decision's toolbar).
     */
    labelled?: boolean;
}

// A switched-off tool keeps its name and gains the reason in its tooltip.
const tip = (name: string, reason?: string) => (reason ? `${name}: ${reason}` : name);

/**
 * The notes and highlights buttons of the reading toolbar, shared by the article's
 * (`ReadingToolbar`) and the decision's (`DecisionReadingToolbar`): one look, one behaviour.
 */
export function NotesHighlightsButtons({
    notesCount, highlightsCount, isNotesOpen, isHighlightsOpen, notesButtonRef, highlightsButtonRef,
    onToggleNotes, onToggleHighlights, lockedReason, labelled = false,
}: NotesHighlightsButtonsProps) {
    if (labelled) {
        // `Button`'s quiet look with the reading row's open state, as `ReadingToolbar`'s tools.
        const word = 'vlx-hover-tile min-w-11 gap-1.5 px-2.5 md:min-w-0 disabled:pointer-events-auto aria-expanded:bg-ink-300/70 aria-expanded:text-slate-900 dark:aria-expanded:bg-ink-700/60 dark:aria-expanded:text-white';
        const count = (n: number) => n > 0 && <span className="tabular-nums text-slate-500 dark:text-slate-400">{n}</span>;
        // The count read apart from the word: «Note, 2», not «Note2».
        const named = (word: string, n: number) => (n > 0 ? `${word}, ${n}` : undefined);
        return (
            <>
                <Button
                    ref={notesButtonRef}
                    type="button"
                    variant="quiet"
                    onClick={onToggleNotes}
                    aria-expanded={isNotesOpen}
                    aria-label={named('Note', notesCount)}
                    className={word}
                    title={tip(isNotesOpen ? 'Chiudi le note' : 'Le note sull’articolo', lockedReason)}
                    disabled={Boolean(lockedReason)}
                    icon={<StickyNote size={16} aria-hidden />}
                >
                    Note
                    {count(notesCount)}
                </Button>
                <Button
                    ref={highlightsButtonRef}
                    type="button"
                    variant="quiet"
                    onClick={onToggleHighlights}
                    aria-expanded={isHighlightsOpen}
                    aria-label={named('Evidenziazioni', highlightsCount)}
                    className={word}
                    title={tip(isHighlightsOpen ? 'Chiudi le evidenziazioni' : 'Mostra, nascondi o esporta le evidenziazioni', lockedReason)}
                    disabled={Boolean(lockedReason)}
                    icon={<Highlighter size={16} aria-hidden />}
                >
                    Evidenziazioni
                    {count(highlightsCount)}
                </Button>
            </>
        );
    }
    const notesName = isNotesOpen ? 'Chiudi note' : 'Apri note';
    const highlightsName = isHighlightsOpen ? 'Chiudi evidenziazioni' : 'Gestisci evidenziazioni';
    return (
        <>
            <IconButton
                ref={notesButtonRef}
                size="sm"
                onClick={onToggleNotes}
                aria-expanded={isNotesOpen}
                aria-label={notesName}
                className={cn("relative disabled:pointer-events-auto",
                    isNotesOpen
                        ? "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400"
                        : notesCount > 0
                            ? "text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                            : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-amber-500"
                )}
                title={tip(notesName, lockedReason)}
                disabled={Boolean(lockedReason)}
                icon={<>
                    <StickyNote aria-hidden />
                    {notesCount > 0 && (
                        <span aria-hidden className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-0.5 bg-amber-500 text-white text-[11px] leading-none rounded-full flex items-center justify-center font-bold">
                            {notesCount}
                        </span>
                    )}
                </>}
            />
            <IconButton
                ref={highlightsButtonRef}
                size="sm"
                onClick={onToggleHighlights}
                aria-expanded={isHighlightsOpen}
                aria-label={highlightsName}
                className={cn("relative disabled:pointer-events-auto",
                    isHighlightsOpen
                        ? "bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400"
                        : highlightsCount > 0
                            ? "text-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/20"
                            : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-primary-600"
                )}
                title={tip(highlightsName, lockedReason)}
                disabled={Boolean(lockedReason)}
                icon={<>
                    <Highlighter aria-hidden />
                    {highlightsCount > 0 && (
                        <span aria-hidden className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-0.5 bg-primary-600 text-white text-[11px] leading-none rounded-full flex items-center justify-center font-bold">
                            {highlightsCount}
                        </span>
                    )}
                </>}
            />
        </>
    );
}
