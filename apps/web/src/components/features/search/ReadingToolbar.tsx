import { useRef, type ReactNode, type Ref } from 'react';
import type { ArticleData } from '../../../types';
import { ExternalLink, Zap, FolderPlus, Copy, MessageCircle, Share2, Download, MoreHorizontal, Clock, BookOpen, GitCompare } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import type { VersionChip } from '../../../utils/versionDisplay';
import { VersionStatusChip } from './VersionStatusChip';
import { NotesHighlightsButtons } from './NotesHighlightsButtons';
import { DiscussionButton } from './DiscussionButton';
import { FindInTextButton } from './FindInTextButton';

export interface ReadingToolbarProps {
    normaData: ArticleData['norma_data'];
    /** What the source says about the version on screen; null shows nothing (no "Vigente" by default). */
    versionChip: VersionChip | null;
    /**
     * Set on a past text: quick-norm, notes, highlights, discussions and Study Mode are
     * switched off, with this as the reason.
     */
    lockedReason?: string;
    /**
     * Set when the text may not be copied, exported or saved (the article did not exist on the
     * day, or the version does not contain it): copy, dossier and "Esporta..." are switched off
     * with this as the reason.
     */
    copyLockedReason?: string;
    url?: string;
    articleText: string;
    isNotesPeekOpen: boolean;
    notesButtonRef?: Ref<HTMLButtonElement | null>;
    notesCount: number;
    dossierButtonRef?: Ref<HTMLButtonElement | null>;
    isHighlightsPeekOpen: boolean;
    highlightsButtonRef?: Ref<HTMLButtonElement | null>;
    highlightsCount: number;
    isDiscussionOpen: boolean;
    showMoreMenu: boolean;
    isPinnedQuick: boolean;
    onToggleNotes: () => void;
    onToggleHighlightsPeek: () => void;
    onToggleDiscussion: () => void;
    onToggleMoreMenu: (next: boolean) => void;
    onToggleQuickNorm: () => void;
    onMobileCopy: () => Promise<void> | void;
    onOpenStudyMode?: () => void;
    onOpenCopyModal: () => void;
    onOpenDossier: () => void;
    onShareLink: () => void;
    onOpenAdvancedExport: () => void;
    onOpenVersionInput: () => void;
    onCompare: () => void;
    /**
     * «Cerca nel testo»: the button (desktop row and phone row) and, while open, the box in a row of its own under the
     * buttons, sticky with the toolbar. Absent when there is no text to search.
     */
    find?: {
        isOpen: boolean;
        /** Told which of the two buttons was on screen, for the box to give focus back to. */
        onToggle: (button: HTMLElement | null) => void;
        bar: ReactNode;
    };
}

export function ReadingToolbar({
    normaData,
    versionChip,
    lockedReason,
    copyLockedReason,
    url,
    isNotesPeekOpen,
    notesButtonRef,
    notesCount,
    dossierButtonRef,
    isHighlightsPeekOpen,
    highlightsButtonRef,
    highlightsCount,
    isDiscussionOpen,
    showMoreMenu,
    isPinnedQuick,
    onToggleNotes,
    onToggleHighlightsPeek,
    onToggleDiscussion,
    onToggleMoreMenu,
    onToggleQuickNorm,
    onMobileCopy,
    onOpenStudyMode,
    onOpenCopyModal,
    onOpenDossier,
    onShareLink,
    onOpenAdvancedExport,
    onOpenVersionInput,
    onCompare,
    find,
}: ReadingToolbarProps) {
    // Both rows are mounted and one is hidden by CSS: the box returns focus to the one on screen.
    const desktopFindRef = useRef<HTMLButtonElement>(null);
    const phoneFindRef = useRef<HTMLButtonElement>(null);
    const toggleFind = () => {
        if (!find) return;
        const desktop = desktopFindRef.current;
        find.onToggle(desktop && desktop.getClientRects().length > 0 ? desktop : phoneFindRef.current);
    };
    // A switched-off tool keeps its name and gains the reason in its tooltip.
    const tip = (name: string, reason?: string) => (reason ? `${name} — ${reason}` : name);
    const lock = (reason?: string) => (reason ? { disabled: true } : {});
    // Exporting writes the article out like a copy does, and the export header
    // carries no version: anything that may not be copied, or is a reading, stays in.
    const exportLockedReason = copyLockedReason ?? lockedReason;
    return (
        <div className={cn('glass-toolbar sticky top-0 flex flex-wrap gap-x-1 gap-y-1 items-center justify-between p-2 rounded-t-xl mb-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-b-2 border-slate-200/50 dark:border-slate-800/50', Z_INDEX.sticky)}>
            {/* Version Info & Annex Source Badge */}
            <div className="contents md:flex md:items-center md:gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                {versionChip && <VersionStatusChip chip={versionChip} onClick={onOpenVersionInput} />}
                {/* Annex Source Badge */}
                {normaData.allegato && (
                    <>
                        {versionChip && <span className="hidden md:inline text-slate-300 dark:text-slate-700">|</span>}
                        <span className="px-2 py-1 rounded-md bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                            Allegato {normaData.allegato}
                        </span>
                    </>
                )}
            </div>

            {/* Mobile: Quick Actions + Study Mode toggle */}
            <div className="flex md:hidden ml-auto flex-wrap justify-end items-center gap-1 [&_button:disabled]:opacity-40 [&_button:disabled]:cursor-not-allowed">
                <button
                    onClick={onToggleQuickNorm}
                    aria-pressed={isPinnedQuick}
                    className={cn(
                        "inline-flex min-h-[44px] min-w-[44px] items-center justify-center p-2 lg:p-2.5 rounded-lg transition-colors",
                        isPinnedQuick
                            ? "bg-amber-50 text-amber-500 dark:bg-amber-900/20 dark:text-amber-400"
                            : "text-slate-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-500"
                    )}
                    title={tip(isPinnedQuick ? "Rimuovi dalle norme rapide" : "Aggiungi a norme rapide", lockedReason)}
                    {...lock(lockedReason)}
                >
                    <Zap size={20} className={cn(isPinnedQuick && "fill-amber-500")} />
                </button>
                <button
                    onClick={onToggleDiscussion}
                    aria-expanded={isDiscussionOpen}
                    aria-haspopup="dialog"
                    className={cn("inline-flex min-h-[44px] min-w-[44px] items-center justify-center p-2 lg:p-2.5 rounded-lg transition-colors relative", isDiscussionOpen ? "bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-primary-500")}
                    title={tip("Discussioni sull’articolo", lockedReason)}
                    {...lock(lockedReason)}
                >
                    <MessageCircle size={20} />
                </button>
                {find && <FindInTextButton ref={phoneFindRef} isOpen={find.isOpen} onToggle={toggleFind} size={20} />}
                <button
                    onClick={() => { void onMobileCopy(); }}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center p-2 lg:p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-emerald-500 transition-colors"
                    title={tip("Copia testo", copyLockedReason)}
                    {...lock(copyLockedReason)}
                >
                    <Copy size={20} />
                </button>
                <button
                    onClick={onOpenDossier}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center p-2 lg:p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-blue-500 transition-colors"
                    title={tip("Aggiungi a dossier", copyLockedReason)}
                    aria-label="Aggiungi a dossier"
                    {...lock(copyLockedReason)}
                >
                    <FolderPlus size={20} />
                </button>
                {/* Study Mode button - sempre visibile */}
                <button
                    onClick={onOpenStudyMode}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center p-2 lg:p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-purple-500 transition-colors"
                    title={tip("Modalità studio", lockedReason)}
                    {...lock(lockedReason)}
                >
                    <BookOpen size={20} />
                </button>
                {url && (
                    <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center p-2 lg:p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-primary-500 transition-colors"
                        title="Apri fonte"
                    >
                        <ExternalLink size={20} />
                    </a>
                )}
            </div>

            {/* Desktop: Full Quick Actions */}
            <div className="hidden md:flex items-center gap-1 [&_button:disabled]:opacity-40 [&_button:disabled]:cursor-not-allowed">
                {/* Primary buttons */}
                <button
                    onClick={onToggleQuickNorm}
                    aria-pressed={isPinnedQuick}
                    className={cn(
                        "p-1.5 rounded-md transition-colors",
                        isPinnedQuick
                            ? "bg-amber-50 text-amber-500 dark:bg-amber-900/20 dark:text-amber-400"
                            : "text-slate-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-500"
                    )}
                    title={tip(isPinnedQuick ? "Rimuovi dalle norme rapide" : "Aggiungi a norme rapide", lockedReason)}
                    {...lock(lockedReason)}
                >
                    <Zap size={16} className={cn(isPinnedQuick && "fill-amber-500")} />
                </button>
                <NotesHighlightsButtons
                    notesCount={notesCount}
                    highlightsCount={highlightsCount}
                    isNotesOpen={isNotesPeekOpen}
                    isHighlightsOpen={isHighlightsPeekOpen}
                    notesButtonRef={notesButtonRef}
                    highlightsButtonRef={highlightsButtonRef}
                    onToggleNotes={onToggleNotes}
                    onToggleHighlights={onToggleHighlightsPeek}
                    lockedReason={lockedReason}
                />
                <DiscussionButton
                    isOpen={isDiscussionOpen}
                    onToggle={onToggleDiscussion}
                    name="Discussioni sull’articolo"
                    lockedReason={lockedReason}
                />
                {find && <FindInTextButton ref={desktopFindRef} isOpen={find.isOpen} onToggle={toggleFind} />}
                <button
                    onClick={onOpenCopyModal}
                    className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-emerald-500 transition-colors"
                    title={tip("Copia", copyLockedReason)}
                    {...lock(copyLockedReason)}
                >
                    <Copy size={16} />
                </button>
                <button
                    ref={dossierButtonRef}
                    onClick={onOpenDossier}
                    className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-blue-500 transition-colors"
                    title={tip("Aggiungi a dossier", copyLockedReason)}
                    aria-label="Aggiungi a dossier"
                    {...lock(copyLockedReason)}
                >
                    <FolderPlus size={16} />
                </button>

                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />

                {/* More menu */}
                <div className="relative">
                    <button
                        onClick={() => onToggleMoreMenu(!showMoreMenu)}
                        className={cn(
                            "p-1.5 rounded-md transition-colors",
                            showMoreMenu
                                ? "bg-slate-100 dark:bg-slate-800 text-primary-500"
                                : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                        )}
                        title="Altre azioni"
                    >
                        <MoreHorizontal size={16} />
                    </button>
                    {showMoreMenu && (
                        <>
                            <div className={cn('fixed inset-0', Z_INDEX.dropdown)} onClick={() => onToggleMoreMenu(false)} />
                            <div className={cn('absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in-95 duration-200 py-1', Z_INDEX.dropdown)}>
                                <button
                                    onClick={() => {
                                        onShareLink();
                                        onToggleMoreMenu(false);
                                    }}
                                    className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                >
                                    <Share2 size={14} className="text-slate-400" />
                                    Condividi link
                                </button>
                                <button
                                    onClick={() => {
                                        onOpenAdvancedExport();
                                        onToggleMoreMenu(false);
                                    }}
                                    title={tip("Esporta...", exportLockedReason)}
                                    {...lock(exportLockedReason)}
                                    className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                >
                                    <Download size={14} className="text-slate-400" />
                                    Esporta...
                                </button>

                                <div className="border-t border-slate-200 dark:border-slate-700 my-1" />

                                <button
                                    onClick={() => {
                                        onOpenVersionInput();
                                        onToggleMoreMenu(false);
                                    }}
                                    className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                >
                                    <Clock size={14} className="text-slate-400" />
                                    Testo alla data...
                                </button>
                                <button
                                    onClick={() => {
                                        onCompare();
                                        onToggleMoreMenu(false);
                                    }}
                                    className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                >
                                    <GitCompare size={14} className="text-slate-400" />
                                    Confronta con...
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
            {find?.isOpen && find.bar}
        </div>
    );
}
