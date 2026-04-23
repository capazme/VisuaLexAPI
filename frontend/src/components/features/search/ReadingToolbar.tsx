import type { Ref } from 'react';
import type { ArticleData } from '../../../types';
import { ExternalLink, Zap, FolderPlus, Copy, StickyNote, Highlighter, Share2, Download, MoreHorizontal, Clock, BookOpen, GitCompare } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';

export interface ReadingToolbarProps {
    normaData: ArticleData['norma_data'];
    versionInfo: ArticleData['versionInfo'];
    url?: string;
    articleText: string;
    isNotesPeekOpen: boolean;
    notesButtonRef?: Ref<HTMLButtonElement | null>;
    notesCount: number;
    isHighlightsPeekOpen: boolean;
    highlightsButtonRef?: Ref<HTMLButtonElement | null>;
    highlightsCount: number;
    showMoreMenu: boolean;
    isPinnedQuick: boolean;
    onToggleNotes: () => void;
    onToggleHighlightsPeek: () => void;
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
}

export function ReadingToolbar({
    normaData,
    versionInfo,
    url,
    articleText: _articleText,
    isNotesPeekOpen,
    notesButtonRef,
    notesCount,
    isHighlightsPeekOpen,
    highlightsButtonRef,
    highlightsCount,
    showMoreMenu,
    isPinnedQuick,
    onToggleNotes,
    onToggleHighlightsPeek,
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
}: ReadingToolbarProps) {
    return (
        <div className={cn('glass-toolbar sticky top-0 flex items-center justify-between p-2 rounded-t-xl mb-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-b-2 border-slate-200/50 dark:border-slate-800/50', Z_INDEX.sticky)}>
            {/* Version Info & Annex Source Badge */}
            <div className="flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                {versionInfo?.isHistorical ? (
                    <span className={cn("px-2 py-1 rounded-md",
                        versionInfo.isHistorical ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300")}>
                        {versionInfo.isHistorical ? "Storica" : "Vigente"}
                    </span>
                ) : (
                    <span className="px-2 py-1 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        Vigente
                    </span>
                )}
                {normaData.data_versione && (
                    <>
                        <span className="text-slate-300 dark:text-slate-700">|</span>
                        <span>Aggiornato al: {normaData.data_versione}</span>
                    </>
                )}
                {/* Annex Source Badge */}
                {normaData.allegato && (
                    <>
                        <span className="text-slate-300 dark:text-slate-700">|</span>
                        <span className="px-2 py-1 rounded-md bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                            Allegato {normaData.allegato}
                        </span>
                    </>
                )}
            </div>

            {/* Mobile: Quick Actions + Study Mode toggle */}
            <div className="flex md:hidden items-center gap-1">
                <button
                    onClick={onToggleQuickNorm}
                    aria-pressed={isPinnedQuick}
                    className={cn(
                        "p-2 lg:p-2.5 rounded-lg transition-colors",
                        isPinnedQuick
                            ? "bg-amber-50 text-amber-500 dark:bg-amber-900/20 dark:text-amber-400"
                            : "text-slate-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-500"
                    )}
                    title={isPinnedQuick ? "Rimuovi dalle norme rapide" : "Aggiungi a norme rapide"}
                >
                    <Zap size={20} className={cn(isPinnedQuick && "fill-amber-500")} />
                </button>
                <button
                    onClick={() => { void onMobileCopy(); }}
                    className="p-2 lg:p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-emerald-500 transition-colors"
                    title="Copia testo"
                >
                    <Copy size={20} />
                </button>
                {/* Study Mode button - sempre visibile */}
                <button
                    onClick={onOpenStudyMode}
                    className="p-2 lg:p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-purple-500 transition-colors"
                    title="Modalità studio"
                >
                    <BookOpen size={20} />
                </button>
                {url && (
                    <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 lg:p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-primary-500 transition-colors"
                        title="Apri fonte"
                    >
                        <ExternalLink size={20} />
                    </a>
                )}
            </div>

            {/* Desktop: Full Quick Actions */}
            <div className="hidden md:flex items-center gap-1">
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
                    title={isPinnedQuick ? "Rimuovi dalle norme rapide" : "Aggiungi a norme rapide"}
                >
                    <Zap size={16} className={cn(isPinnedQuick && "fill-amber-500")} />
                </button>
                <button
                    ref={notesButtonRef}
                    onClick={onToggleNotes}
                    aria-expanded={isNotesPeekOpen}
                    aria-haspopup="dialog"
                    className={cn("p-1.5 rounded-md transition-colors relative",
                        isNotesPeekOpen
                            ? "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400"
                            : notesCount > 0
                                ? "text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                                : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-amber-500"
                    )}
                    title={isNotesPeekOpen ? "Chiudi note" : "Apri note"}
                >
                    <StickyNote size={16} />
                    {notesCount > 0 && (
                        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-amber-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                            {notesCount}
                        </span>
                    )}
                </button>
                <button
                    ref={highlightsButtonRef}
                    onClick={onToggleHighlightsPeek}
                    aria-expanded={isHighlightsPeekOpen}
                    aria-haspopup="dialog"
                    className={cn(
                        "p-1.5 rounded-md transition-colors relative",
                        isHighlightsPeekOpen
                            ? "bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400"
                            : highlightsCount > 0
                                ? "text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                                : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-purple-500"
                    )}
                    title={isHighlightsPeekOpen ? "Chiudi evidenziazioni" : "Gestisci evidenziazioni"}
                >
                    <Highlighter size={16} />
                    {highlightsCount > 0 && (
                        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-purple-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                            {highlightsCount}
                        </span>
                    )}
                </button>
                <button
                    onClick={onOpenCopyModal}
                    className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-emerald-500 transition-colors"
                    title="Copia"
                >
                    <Copy size={16} />
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
                                        onOpenDossier();
                                        onToggleMoreMenu(false);
                                    }}
                                    className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                >
                                    <FolderPlus size={14} className="text-slate-400" />
                                    Aggiungi a dossier
                                </button>
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
                                    className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
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
                                    Cerca versione...
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
        </div>
    );
}
