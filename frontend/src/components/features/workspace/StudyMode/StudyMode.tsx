import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAppStore } from '../../../../store/useAppStore';
import { useStudyModeShortcuts } from './hooks/useStudyModeShortcuts';
import { StudyModeHeader } from './StudyModeHeader';
import { StudyModeContent } from './StudyModeContent';
import { StudyModeToolsPanel } from './StudyModeToolsPanel';
import { StudyModeBrocardiPopover } from './StudyModeBrocardiPopover';
import { StudyModeSettings } from './StudyModeSettings';
import { cn } from '../../../../lib/utils';
import type { ArticleData, NormaVisitata, SearchParams } from '../../../../types';
import { useTour } from '../../../../hooks/useTour';

export interface StudyModeProps {
  /** When true (default), the component is visible */
  isOpen?: boolean;
  onClose: () => void;
  article: ArticleData;
  /** Array of articles for navigation. If not provided, single-article mode is used */
  articles?: ArticleData[];
  /** Callback when navigating between articles. Only needed if articles array is provided */
  onNavigate?: (articleId: string) => void;
  onCrossReferenceNavigate?: (articleNumber: string, normaData: NormaVisitata) => void;
  /** Label for the norma. If not provided, generated from article data */
  normaLabel?: string;
  allArticleIds?: string[];
  onLoadArticle?: (id: string) => void;
}

export type StudyModeTheme = 'light' | 'dark' | 'sepia';

const THEME_STYLES: Record<StudyModeTheme, { bg: string; text: string }> = {
  light: {
    bg: 'bg-white',
    text: 'text-slate-900'
  },
  dark: {
    bg: 'bg-slate-900',
    text: 'text-slate-100'
  },
  sepia: {
    bg: 'bg-[#f4ecd8]',
    text: 'text-[#5c4b37]'
  }
};

// Convert NormaVisitata to SearchParams for quickNorm
function normaToSearchParams(norma: NormaVisitata): SearchParams {
  return {
    act_type: norma.tipo_atto || '',
    act_number: norma.numero_atto || '',
    date: norma.data || '',
    article: norma.numero_articolo?.toString() || '',
    version: (norma.versione === 'originale' ? 'originale' : 'vigente') as 'vigente' | 'originale',
    show_brocardi_info: true,
  };
}

// Generate a label for QuickNorm from NormaVisitata
function generateQuickNormLabel(norma: NormaVisitata): string {
  const parts = [`Art. ${norma.numero_articolo}`];
  if (norma.tipo_atto) {
    const abbrev = norma.tipo_atto
      .replace('codice civile', 'CC')
      .replace('codice penale', 'CP')
      .replace('codice di procedura civile', 'CPC')
      .replace('codice di procedura penale', 'CPP')
      .replace('costituzione', 'Cost.')
      .replace(/^decreto legislativo$/i, 'D.Lgs.')
      .replace(/^decreto legge$/i, 'D.L.')
      .replace(/^legge$/i, 'L.');
    parts.push(abbrev);
  }
  if (norma.numero_atto) {
    parts.push(`n. ${norma.numero_atto}`);
  }
  return parts.join(' ');
}

export function StudyMode({
  isOpen = true,
  onClose,
  article,
  articles: articlesProp,
  onNavigate,
  onCrossReferenceNavigate,
  normaLabel: normaLabelProp,
  allArticleIds: _allArticleIds,
  onLoadArticle: _onLoadArticle
}: StudyModeProps) {
  // Handle single article mode: create single-element array if not provided
  const articles = articlesProp ?? [article];

  // Generate norma label if not provided
  const normaLabel = normaLabelProp ?? `${article.norma_data.tipo_atto}${article.norma_data.numero_atto ? ` ${article.norma_data.numero_atto}` : ''}`;

  // Typography state
  const [fontSize, setFontSize] = useState(18);
  const [lineHeight, setLineHeight] = useState(1.8);
  const [theme, setTheme] = useState<StudyModeTheme>('light');

  // Window state - detect mobile for initial fullscreen
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 640
  );
  const [isFullscreen, setIsFullscreen] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 640
  );
  const [position, setPosition] = useState({ x: 80, y: 60 });
  const [size, setSize] = useState({ width: 900, height: 700 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  // UI state
  const [showSettings, setShowSettings] = useState(false);
  const [noteInputFocused, setNoteInputFocused] = useState(false);
  const [showToolsPanel, setShowToolsPanel] = useState(false);
  const [showBrocardi, setShowBrocardi] = useState(false);

  // Store access
  const {
    annotations,
    highlights,
    addAnnotation,
    removeAnnotation,
    addHighlight,
    removeHighlight,
    addQuickNorm,
    removeQuickNormByParams,
    isQuickNorm
  } = useAppStore();

  const { tryStartTour } = useTour();

  // Start study mode tour on first open
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure the component is rendered
      const timer = setTimeout(() => {
        tryStartTour('studyMode');
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isOpen, tryStartTour]);

  // Navigation helpers
  const currentIndex = useMemo(() =>
    articles.findIndex(a => a.norma_data.numero_articolo === article.norma_data.numero_articolo),
    [articles, article.norma_data.numero_articolo]
  );

  const handleNavigate = useCallback((direction: 'prev' | 'next') => {
    // Skip navigation if no callback provided or single article
    if (!onNavigate || articles.length <= 1) return;

    if (direction === 'prev' && currentIndex > 0) {
      onNavigate(articles[currentIndex - 1].norma_data.numero_articolo);
    } else if (direction === 'next' && currentIndex < articles.length - 1) {
      onNavigate(articles[currentIndex + 1].norma_data.numero_articolo);
    }
  }, [currentIndex, articles, onNavigate]);

  const handleFontSize = useCallback((delta: number) => {
    setFontSize(prev => Math.min(32, Math.max(14, prev + delta)));
  }, []);

  const handleToggleBrocardi = useCallback(() => {
    setShowBrocardi(prev => !prev);
  }, []);

  const handleToggleTools = useCallback(() => {
    setShowToolsPanel(prev => !prev);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    // Don't allow exiting fullscreen on mobile
    if (isMobile) return;
    setIsFullscreen(prev => !prev);
  }, [isMobile]);

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (isFullscreen) return;
    e.preventDefault();
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y
    };
  }, [isFullscreen, position]);

  const handleDragMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPosition({
      x: Math.max(0, dragRef.current.startPosX + dx),
      y: Math.max(0, dragRef.current.startPosY + dy)
    });
  }, [isDragging]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    dragRef.current = null;
  }, []);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (isFullscreen) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: size.width,
      startH: size.height
    };
  }, [isFullscreen, size]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !resizeRef.current) return;
    const dx = e.clientX - resizeRef.current.startX;
    const dy = e.clientY - resizeRef.current.startY;
    setSize({
      width: Math.max(600, resizeRef.current.startW + dx),
      height: Math.max(400, resizeRef.current.startH + dy)
    });
  }, [isResizing]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    resizeRef.current = null;
  }, []);

  // Global mouse event listeners for drag/resize
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      return () => {
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
      };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleResizeMove);
      window.addEventListener('mouseup', handleResizeEnd);
      return () => {
        window.removeEventListener('mousemove', handleResizeMove);
        window.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  const handleToggleSettings = useCallback(() => {
    setShowSettings(prev => !prev);
  }, []);

  const handleBookmark = useCallback(() => {
    const searchParams = normaToSearchParams(article.norma_data);
    if (isQuickNorm(searchParams)) {
      removeQuickNormByParams(searchParams);
    } else {
      const label = generateQuickNormLabel(article.norma_data);
      addQuickNorm(label, searchParams);
    }
  }, [article.norma_data, isQuickNorm, addQuickNorm, removeQuickNormByParams]);

  const handleNewNote = useCallback(() => {
    setShowToolsPanel(true);
    setNoteInputFocused(true);
  }, []);

  // Keyboard shortcuts
  useStudyModeShortcuts({
    onClose,
    onNavigate: handleNavigate,
    onFontSize: handleFontSize,
    onToggleBrocardi: handleToggleBrocardi,
    onToggleTools: handleToggleTools,
    onToggleSettings: handleToggleSettings,
    onTheme: setTheme,
    onBookmark: handleBookmark,
    onNewNote: handleNewNote,
    onToggleFullscreen: handleToggleFullscreen
  }, { enabled: isOpen });

  // Detect mobile and handle resize
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 640;
      setIsMobile(mobile);
      // Force fullscreen on mobile
      if (mobile && !isFullscreen) {
        setIsFullscreen(true);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isFullscreen]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Generate norma key for annotations/highlights
  const normaKey = useMemo(() => generateNormaKey(article.norma_data), [article.norma_data]);

  // Filter annotations and highlights for current article
  const articleAnnotations = useMemo(() =>
    annotations.filter(a => a.normaKey === normaKey && a.articleId === article.norma_data.numero_articolo),
    [annotations, normaKey, article.norma_data.numero_articolo]
  );

  const articleHighlights = useMemo(() =>
    highlights.filter(h => h.normaKey === normaKey && h.articleId === article.norma_data.numero_articolo),
    [highlights, normaKey, article.norma_data.numero_articolo]
  );

  const isCurrentlyBookmarked = isQuickNorm(normaToSearchParams(article.norma_data));
  const themeStyle = THEME_STYLES[theme];

  if (!isOpen) return null;

  const windowStyle = isFullscreen
    ? {}
    : {
      left: position.x,
      top: position.y,
      width: size.width,
      height: size.height,
    };

  // Render via Portal to escape tab stacking context
  return createPortal(
    <AnimatePresence>
      {/* Backdrop - covers entire viewport */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Window - above everything */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        style={isFullscreen ? undefined : windowStyle}
        className={cn(
          "fixed z-[130] flex flex-col shadow-2xl overflow-hidden",
          isFullscreen && "inset-0",
          !isFullscreen && "rounded-2xl border",
          isDragging && "cursor-grabbing select-none",
          themeStyle.bg,
          themeStyle.text,
          !isFullscreen && (theme === 'dark' ? 'border-slate-700' : theme === 'sepia' ? 'border-[#d4c4a8]' : 'border-slate-200')
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - always visible */}
        <StudyModeHeader
          visible={true}
          article={article}
          normaLabel={normaLabel}
          currentIndex={currentIndex}
          totalArticles={articles.length}
          onClose={onClose}
          onNavigate={handleNavigate}
          onToggleSettings={handleToggleSettings}
          onBookmark={handleBookmark}
          isBookmarked={isCurrentlyBookmarked}
          theme={theme}
          onThemeChange={setTheme}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
          onDragStart={handleDragStart}
          isDragging={isDragging}
          showToolsPanel={showToolsPanel}
          onToggleTools={handleToggleTools}
          showBrocardi={showBrocardi}
          onToggleBrocardi={handleToggleBrocardi}
        />

        {/* Main content area */}
        <div className="flex-1 flex relative overflow-hidden">
          {/* Tools Panel - Left */}
          <StudyModeToolsPanel
            visible={showToolsPanel}
            isPinned={showToolsPanel}
            onTogglePin={handleToggleTools}
            onMouseEnter={() => { }}
            onMouseLeave={() => { }}
            annotations={articleAnnotations}
            highlights={articleHighlights}
            normaKey={normaKey}
            articleId={article.norma_data.numero_articolo}
            onAddAnnotation={addAnnotation}
            onRemoveAnnotation={removeAnnotation}
            onRemoveHighlight={removeHighlight}
            focusNoteInput={noteInputFocused}
            onNoteInputFocused={() => setNoteInputFocused(false)}
            theme={theme}
          />

          {/* Central Content */}
          <StudyModeContent
            article={article}
            fontSize={fontSize}
            lineHeight={lineHeight}
            theme={theme}
            highlights={articleHighlights}
            normaKey={normaKey}
            footnotes={article.brocardi_info?.Footnotes ?? []}
            onAddHighlight={addHighlight}
            onCrossReferenceNavigate={onCrossReferenceNavigate}
          />

          {/* Brocardi Popover - positioned in corner */}
          <StudyModeBrocardiPopover
            visible={showBrocardi}
            onClose={() => setShowBrocardi(false)}
            brocardiInfo={article.brocardi_info ?? undefined}
            theme={theme}
          />
        </div>

        {/* Footer - shortcuts on desktop, simplified on mobile */}
        <div className={cn(
          "flex items-center justify-center sm:justify-between px-2 sm:px-4 py-2 border-t text-xs transition-colors",
          theme === 'dark' ? 'bg-slate-800/50 border-slate-700 text-slate-400'
            : theme === 'sepia' ? 'bg-[#efe5d1] border-[#d4c4a8] text-[#8b7355]'
              : 'bg-slate-50 border-slate-200 text-slate-500'
        )}>
          {/* Mobile: simplified message */}
          <div className="sm:hidden text-center">
            Swipe o usa i pulsanti per navigare
          </div>
          {/* Desktop: full keyboard shortcuts */}
          <div className="hidden sm:flex items-center gap-4">
            <span><kbd className={cn("px-1.5 py-0.5 rounded text-xs font-mono", theme === 'dark' ? 'bg-slate-700 text-slate-300' : theme === 'sepia' ? 'bg-[#e4d4b8] text-[#5c4b37]' : 'bg-white border border-slate-200 shadow-sm text-slate-600')}>ESC</kbd> Chiudi</span>
            <span><kbd className={cn("px-1.5 py-0.5 rounded text-xs font-mono", theme === 'dark' ? 'bg-slate-700 text-slate-300' : theme === 'sepia' ? 'bg-[#e4d4b8] text-[#5c4b37]' : 'bg-white border border-slate-200 shadow-sm text-slate-600')}>←→</kbd> Naviga</span>
            <span><kbd className={cn("px-1.5 py-0.5 rounded text-xs font-mono", theme === 'dark' ? 'bg-slate-700 text-slate-300' : theme === 'sepia' ? 'bg-[#e4d4b8] text-[#5c4b37]' : 'bg-white border border-slate-200 shadow-sm text-slate-600')}>F</kbd> Fullscreen</span>
          </div>
          <div className="hidden sm:flex items-center gap-4">
            <span><kbd className={cn("px-1.5 py-0.5 rounded text-xs font-mono", theme === 'dark' ? 'bg-slate-700 text-slate-300' : theme === 'sepia' ? 'bg-[#e4d4b8] text-[#5c4b37]' : 'bg-white border border-slate-200 shadow-sm text-slate-600')}>T</kbd> Note</span>
            <span><kbd className={cn("px-1.5 py-0.5 rounded text-xs font-mono", theme === 'dark' ? 'bg-slate-700 text-slate-300' : theme === 'sepia' ? 'bg-[#e4d4b8] text-[#5c4b37]' : 'bg-white border border-slate-200 shadow-sm text-slate-600')}>B</kbd> Brocardi</span>
            <span><kbd className={cn("px-1.5 py-0.5 rounded text-xs font-mono", theme === 'dark' ? 'bg-slate-700 text-slate-300' : theme === 'sepia' ? 'bg-[#e4d4b8] text-[#5c4b37]' : 'bg-white border border-slate-200 shadow-sm text-slate-600')}>S</kbd> Settings</span>
          </div>
        </div>

        {/* Resize handle (bottom-right corner) */}
        {!isFullscreen && (
          <div
            onMouseDown={handleResizeStart}
            className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
            style={{
              background: 'linear-gradient(135deg, transparent 50%, rgba(148,163,184,0.3) 50%)'
            }}
          />
        )}

        {/* Settings Popover */}
        <StudyModeSettings
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          fontSize={fontSize}
          onFontSizeChange={setFontSize}
          lineHeight={lineHeight}
          onLineHeightChange={setLineHeight}
          theme={theme}
          onThemeChange={setTheme}
        />
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

// Helper to generate consistent norma keys
function generateNormaKey(normaData: ArticleData['norma_data']): string {
  const sanitize = (str: string) => str.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();
  const parts = [normaData.tipo_atto];
  if (normaData.numero_atto?.trim()) parts.push(normaData.numero_atto);
  if (normaData.data?.trim()) parts.push(normaData.data);
  if (normaData.numero_articolo?.trim()) parts.push(normaData.numero_articolo);
  return parts.map(part => sanitize(part || '')).join('--');
}

export default StudyMode;
