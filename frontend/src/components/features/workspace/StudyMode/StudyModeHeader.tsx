import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Settings, Zap, Sun, Moon, BookOpen, Maximize2, Minimize2, GripHorizontal, StickyNote, Lightbulb } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { ArticleData } from '../../../../types';
import type { StudyModeTheme } from './StudyMode';

interface StudyModeHeaderProps {
  visible: boolean;
  article: ArticleData;
  normaLabel: string;
  currentIndex: number;
  totalArticles: number;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  onToggleSettings: () => void;
  onBookmark: () => void;
  isBookmarked: boolean;
  theme: StudyModeTheme;
  onThemeChange: (theme: StudyModeTheme) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onDragStart?: (e: React.MouseEvent) => void;
  isDragging?: boolean;
  showToolsPanel?: boolean;
  onToggleTools?: () => void;
  showBrocardi?: boolean;
  onToggleBrocardi?: () => void;
}

const THEME_HEADER_STYLES: Record<StudyModeTheme, { bg: string; border: string; button: string }> = {
  light: {
    bg: 'bg-white/95 backdrop-blur-sm',
    border: 'border-slate-200',
    button: 'hover:bg-slate-100 text-slate-600'
  },
  dark: {
    bg: 'bg-slate-900/95 backdrop-blur-sm',
    border: 'border-slate-700',
    button: 'hover:bg-slate-800 text-slate-400'
  },
  sepia: {
    bg: 'bg-[#f4ecd8]/95 backdrop-blur-sm',
    border: 'border-[#d4c4a8]',
    button: 'hover:bg-[#e4d4b8] text-[#8b7355]'
  }
};

export function StudyModeHeader({
  visible,
  article,
  normaLabel,
  currentIndex,
  totalArticles,
  onClose,
  onNavigate,
  onToggleSettings,
  onBookmark,
  isBookmarked,
  theme,
  onThemeChange,
  isFullscreen,
  onToggleFullscreen,
  onDragStart,
  isDragging,
  showToolsPanel,
  onToggleTools,
  showBrocardi,
  onToggleBrocardi
}: StudyModeHeaderProps) {
  const styles = THEME_HEADER_STYLES[theme];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < totalArticles - 1;

  return (
    <AnimatePresence>
      {visible && (
        <motion.header
          initial={{ y: '-100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className={cn(
            "absolute top-0 left-0 right-0 z-20 border-b",
            styles.bg,
            styles.border
          )}
        >
          <div className="flex items-center justify-between px-2 sm:px-4 py-2.5 gap-1 sm:gap-2">
            {/* Left: Close, Drag handle & Title */}
            <div className="flex items-center gap-1 sm:gap-2 flex-1 min-w-0">
              <button
                onClick={onClose}
                className={cn("p-1.5 sm:p-2 rounded-md transition-colors", styles.button)}
                title="Chiudi (ESC)"
              >
                <X size={18} />
              </button>

              {/* Drag handle - only when not fullscreen and on larger screens */}
              {!isFullscreen && onDragStart && (
                <div
                  onMouseDown={onDragStart}
                  className={cn(
                    "hidden sm:block p-2 rounded-md transition-colors cursor-grab",
                    isDragging ? "cursor-grabbing bg-slate-200 dark:bg-slate-700" : styles.button
                  )}
                  title="Trascina finestra"
                >
                  <GripHorizontal size={18} />
                </div>
              )}

              <div className="min-w-0 ml-1 sm:ml-2">
                <h1 className="font-semibold text-xs sm:text-sm truncate max-w-[100px] sm:max-w-none tracking-tight">{normaLabel}</h1>
                <p className={cn(
                  "text-xs truncate hidden sm:block font-medium",
                  theme === 'dark' ? 'text-slate-400' : theme === 'sepia' ? 'text-[#8b7355]' : 'text-slate-500'
                )}>
                  Art. {article.norma_data.numero_articolo}
                </p>
              </div>
            </div>

            {/* Center: Navigation */}
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                onClick={() => onNavigate('prev')}
                disabled={!hasPrev}
                className={cn(
                  "p-1.5 sm:p-2 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed",
                  styles.button
                )}
                title="Precedente (←)"
              >
                <ChevronLeft size={18} className="sm:w-5 sm:h-5" />
              </button>

              <span className={cn(
                "text-xs sm:text-sm font-medium min-w-[40px] sm:min-w-[60px] text-center tabular-nums",
                theme === 'dark' ? 'text-slate-400' : theme === 'sepia' ? 'text-[#8b7355]' : 'text-slate-500'
              )}>
                {currentIndex + 1}
                <span className="opacity-50 mx-1">/</span>
                {totalArticles}
              </span>

              <button
                onClick={() => onNavigate('next')}
                disabled={!hasNext}
                className={cn(
                  "p-1.5 sm:p-2 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed",
                  styles.button
                )}
                title="Successivo (→)"
              >
                <ChevronRight size={18} className="sm:w-5 sm:h-5" />
              </button>
            </div>

            {/* Right: Panels, Theme, Settings, Bookmark, Fullscreen */}
            <div className="flex items-center gap-0.5 sm:gap-1 flex-1 justify-end">
              {/* Panel Toggles */}
              {onToggleTools && (
                <button
                  id="tour-study-notes"
                  onClick={onToggleTools}
                  className={cn(
                    "p-1.5 sm:p-2 rounded-md transition-colors",
                    showToolsPanel ? 'text-primary-600 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-400' : styles.button
                  )}
                  title="Note e highlights (T)"
                >
                  <StickyNote size={14} className="sm:w-4 sm:h-4" />
                </button>
              )}

              {onToggleBrocardi && (
                <button
                  id="tour-study-brocardi"
                  onClick={onToggleBrocardi}
                  className={cn(
                    "p-1.5 sm:p-2 rounded-md transition-colors",
                    showBrocardi ? 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400' : styles.button
                  )}
                  title="Approfondimenti (B)"
                >
                  <Lightbulb size={14} className="sm:w-4 sm:h-4" />
                </button>
              )}

              <div className="hidden sm:block w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />

              {/* Quick Theme Toggle - hidden on mobile, use settings instead */}
              <div id="tour-study-theme" className={cn(
                "hidden sm:flex items-center rounded-lg p-0.5 border",
                theme === 'dark' ? 'bg-slate-800 border-slate-700' : theme === 'sepia' ? 'bg-[#e4d4b8] border-[#d4c4a8]' : 'bg-slate-100 border-slate-200'
              )}>
                <button
                  onClick={() => onThemeChange('light')}
                  className={cn(
                    "p-1 rounded-md transition-all",
                    theme === 'light' ? 'bg-white shadow-sm text-yellow-500' : 'text-slate-400 hover:text-slate-500'
                  )}
                  title="Tema chiaro (1)"
                >
                  <Sun size={12} />
                </button>
                <button
                  onClick={() => onThemeChange('sepia')}
                  className={cn(
                    "p-1 rounded-md transition-all",
                    theme === 'sepia' ? 'bg-white shadow-sm text-amber-600' : 'text-slate-400 hover:text-slate-500'
                  )}
                  title="Tema seppia (2)"
                >
                  <BookOpen size={12} />
                </button>
                <button
                  onClick={() => onThemeChange('dark')}
                  className={cn(
                    "p-1 rounded-md transition-all",
                    theme === 'dark' ? 'bg-slate-700 shadow-sm text-blue-400' : 'text-slate-400 hover:text-slate-500'
                  )}
                  title="Tema scuro (3)"
                >
                  <Moon size={12} />
                </button>
              </div>

              <button
                onClick={onToggleSettings}
                className={cn("p-1.5 sm:p-2 rounded-md transition-colors", styles.button)}
                title="Impostazioni (S)"
              >
                <Settings size={14} className="sm:w-4 sm:h-4" />
              </button>

              <button
                onClick={onBookmark}
                className={cn(
                  "p-1.5 sm:p-2 rounded-md transition-colors",
                  isBookmarked ? 'text-amber-500 fill-amber-500' : styles.button
                )}
                title="Norma rapida (⌘B)"
              >
                <Zap size={14} className={cn("sm:w-4 sm:h-4", isBookmarked ? 'fill-current' : '')} />
              </button>

              {/* Fullscreen Toggle */}
              {onToggleFullscreen && (
                <button
                  onClick={onToggleFullscreen}
                  className={cn("p-1.5 sm:p-2 rounded-md transition-colors", styles.button)}
                  title={isFullscreen ? "Riduci (F)" : "Espandi (F)"}
                >
                  {isFullscreen ? <Minimize2 size={14} className="sm:w-4 sm:h-4" /> : <Maximize2 size={14} className="sm:w-4 sm:h-4" />}
                </button>
              )}
            </div>
          </div>
        </motion.header>
      )}
    </AnimatePresence>
  );
}
