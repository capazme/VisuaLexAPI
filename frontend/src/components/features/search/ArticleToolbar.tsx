import { useState, useRef, useEffect } from 'react';
import { Star, StarOff, Pencil, Highlighter, Book, MoreHorizontal, GitCompare, FolderPlus, Copy, FileDown, Share2 } from 'lucide-react';
import { cn } from '../../../lib/utils';

interface ArticleToolbarProps {
  // Bookmark
  isBookmarked: boolean;
  onToggleBookmark: () => void;

  // Notes
  showNotes: boolean;
  onToggleNotes: () => void;
  notesCount?: number;

  // Highlights
  onOpenHighlights: () => void;
  highlightsCount?: number;

  // Brocardi
  hasBrocardi: boolean;
  onOpenBrocardi: () => void;

  // Quick Actions
  onCompare: () => void;
  onAddToDossier: () => void;
  onCopyWithCitation: () => void;

  // Export/Share
  onExportRTF: () => void;
  onExportPDF?: () => void;
  onShare: () => void;

  // Style
  className?: string;
  variant?: 'default' | 'compact';
}

export function ArticleToolbar({
  isBookmarked,
  onToggleBookmark,
  showNotes,
  onToggleNotes,
  notesCount = 0,
  onOpenHighlights,
  highlightsCount = 0,
  hasBrocardi,
  onOpenBrocardi,
  onCompare,
  onAddToDossier,
  onCopyWithCitation,
  onExportRTF,
  onExportPDF,
  onShare,
  className,
  variant = 'default',
}: ArticleToolbarProps) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        moreMenuOpen &&
        moreButtonRef.current &&
        moreMenuRef.current &&
        !moreButtonRef.current.contains(e.target as Node) &&
        !moreMenuRef.current.contains(e.target as Node)
      ) {
        setMoreMenuOpen(false);
        setExportMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [moreMenuOpen]);

  const handleMoreAction = (action: () => void) => {
    action();
    setMoreMenuOpen(false);
    setExportMenuOpen(false);
  };

  const isCompact = variant === 'compact';

  return (
    <div
      className={cn(
        "flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800",
        className
      )}
    >
      {/* Primary Actions */}
      <div className="flex items-center gap-1">
        {/* Bookmark */}
        <button
          onClick={onToggleBookmark}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-sm transition-all",
            isBookmarked
              ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-200 dark:hover:bg-yellow-900/40"
              : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-300 dark:border-gray-700"
          )}
          title={isBookmarked ? "Rimuovi segnalibro" : "Aggiungi segnalibro"}
        >
          {isBookmarked ? <Star size={16} className="fill-current" /> : <StarOff size={16} />}
          {!isCompact && <span>{isBookmarked ? "Salvato" : "Salva"}</span>}
        </button>

        {/* Notes */}
        <button
          onClick={onToggleNotes}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-sm transition-all",
            showNotes
              ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/40"
              : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-300 dark:border-gray-700"
          )}
          title="Note"
        >
          <Pencil size={16} />
          {!isCompact && <span>Nota</span>}
          {notesCount > 0 && (
            <span className="px-1.5 py-0.5 bg-blue-200 dark:bg-blue-800 text-blue-700 dark:text-blue-300 rounded text-xs font-semibold">
              {notesCount}
            </span>
          )}
        </button>

        {/* Highlights */}
        <button
          onClick={onOpenHighlights}
          className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-sm transition-all bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-300 dark:border-gray-700"
          title="Evidenzia testo"
        >
          <Highlighter size={16} />
          {!isCompact && <span>Evidenzia</span>}
          {highlightsCount > 0 && (
            <span className="px-1.5 py-0.5 bg-yellow-200 dark:bg-yellow-800 text-yellow-700 dark:text-yellow-300 rounded text-xs font-semibold">
              {highlightsCount}
            </span>
          )}
        </button>

        {/* Brocardi */}
        {hasBrocardi && (
          <button
            onClick={onOpenBrocardi}
            className="flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-sm transition-all bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-300 dark:border-gray-700"
            title="Approfondimenti Brocardi"
          >
            <Book size={16} />
            {!isCompact && <span>Brocardi</span>}
          </button>
        )}
      </div>

      <div className="flex-1" />

      {/* More Menu */}
      <div className="relative">
        <button
          ref={moreButtonRef}
          onClick={() => setMoreMenuOpen(!moreMenuOpen)}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-sm transition-all",
            "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-300 dark:border-gray-700"
          )}
          title="Altre azioni"
        >
          <MoreHorizontal size={16} />
          {!isCompact && <span>Altro</span>}
        </button>

        {/* Dropdown Menu */}
        {moreMenuOpen && (
          <div
            ref={moreMenuRef}
            className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-xl z-50 overflow-hidden"
          >
            {/* Quick Actions Section */}
            <div className="py-1">
              <button
                onClick={() => handleMoreAction(onCompare)}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <GitCompare size={16} className="text-gray-500" />
                <span>Confronta articolo</span>
              </button>
              <button
                onClick={() => handleMoreAction(onAddToDossier)}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <FolderPlus size={16} className="text-gray-500" />
                <span>Aggiungi a dossier</span>
              </button>
              <button
                onClick={() => handleMoreAction(onCopyWithCitation)}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <Copy size={16} className="text-gray-500" />
                <span>Copia con citazione</span>
              </button>
            </div>

            {/* Divider */}
            <div className="h-px bg-gray-200 dark:bg-gray-800" />

            {/* Export/Share Section */}
            <div className="py-1">
              <button
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                className="w-full flex items-center justify-between gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <FileDown size={16} className="text-gray-500" />
                  <span>Esporta</span>
                </div>
                <span className="text-xs text-gray-400">›</span>
              </button>

              {/* Export Submenu */}
              {exportMenuOpen && (
                <div className="pl-8 py-1 bg-gray-50 dark:bg-gray-800/50">
                  <button
                    onClick={() => handleMoreAction(onExportRTF)}
                    className="w-full text-left px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                  >
                    Formato RTF
                  </button>
                  {onExportPDF && (
                    <button
                      onClick={() => handleMoreAction(onExportPDF)}
                      className="w-full text-left px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                    >
                      Formato PDF
                    </button>
                  )}
                </div>
              )}

              <button
                onClick={() => handleMoreAction(onShare)}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <Share2 size={16} className="text-gray-500" />
                <span>Condividi link</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
