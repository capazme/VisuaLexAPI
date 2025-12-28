import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowLeftRight, Link2, Link2Off, Maximize2, Minimize2, FileText, Search, Loader2, Layers, ChevronRight, Zap, Calendar, Clock } from 'lucide-react';
import { useCompare, openCompareWithArticle, type CompareArticle } from '../../../hooks/useCompare';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../lib/utils';
import { ArticleDiff } from './ArticleDiff';
import { Z_INDEX } from '../../../constants/zIndex';
import { parseLegalCitation, isSearchReady, formatParsedCitation, toSearchParams } from '../../../utils/citationParser';
import { parseItalianDate } from '../../../utils/dateUtils';
import type { ArticleData } from '../../../types';

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// Available article item from tabs/history
interface AvailableArticle {
  id: string;
  article: ArticleData;
  sourceNorma: {
    tipo_atto: string;
    numero_atto?: string;
    data?: string;
    urn?: string;
  };
  label: string;
  source: 'tab' | 'history' | 'search';
  tabName?: string;
}

// Article Selector Panel - shown when no article is selected
interface ArticleSelectorPanelProps {
  side: 'left' | 'right';
}

function ArticleSelectorPanel({ side }: ArticleSelectorPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AvailableArticle[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'available' | 'search'>('available');

  // Version selection for temporal comparison
  const [version, setVersion] = useState<'vigente' | 'originale' | 'data'>('vigente');
  const [versionDate, setVersionDate] = useState('');

  const { workspaceTabs } = useAppStore();

  // Smart citation parsing (same as CommandPalette)
  const parsedCitation = useMemo(() => {
    if (!searchQuery || searchQuery.length < 3) return null;
    return parseLegalCitation(searchQuery);
  }, [searchQuery]);

  const citationReady = useMemo(() => isSearchReady(parsedCitation), [parsedCitation]);
  const citationPreview = useMemo(() => parsedCitation ? formatParsedCitation(parsedCitation) : '', [parsedCitation]);

  // Collect available articles from workspace tabs
  const availableArticles: AvailableArticle[] = [];

  workspaceTabs.forEach(tab => {
    tab.content.forEach(item => {
      if (item.type === 'norma') {
        item.articles.forEach(article => {
          availableArticles.push({
            id: `${tab.id}-${item.id}-${article.norma_data.numero_articolo}`,
            article,
            sourceNorma: {
              tipo_atto: item.norma.tipo_atto,
              numero_atto: item.norma.numero_atto,
              data: item.norma.data,
              urn: item.norma.urn,
            },
            label: `Art. ${article.norma_data.numero_articolo} - ${item.norma.tipo_atto}${item.norma.numero_atto ? ` n. ${item.norma.numero_atto}` : ''}`,
            source: 'tab',
            tabName: tab.label,
          });
        });
      } else if (item.type === 'loose-article') {
        availableArticles.push({
          id: `${tab.id}-${item.id}`,
          article: item.article,
          sourceNorma: item.sourceNorma,
          label: `Art. ${item.article.norma_data.numero_articolo} - ${item.sourceNorma.tipo_atto}${item.sourceNorma.numero_atto ? ` n. ${item.sourceNorma.numero_atto}` : ''}`,
          source: 'tab',
          tabName: tab.label,
        });
      } else if (item.type === 'collection') {
        item.articles.forEach(({ article, sourceNorma }) => {
          availableArticles.push({
            id: `${tab.id}-${item.id}-${article.norma_data.numero_articolo}`,
            article,
            sourceNorma,
            label: `Art. ${article.norma_data.numero_articolo} - ${sourceNorma.tipo_atto}${sourceNorma.numero_atto ? ` n. ${sourceNorma.numero_atto}` : ''}`,
            source: 'tab',
            tabName: tab.label,
          });
        });
      }
    });
  });

  // Handle article selection
  const handleSelectArticle = (item: AvailableArticle) => {
    openCompareWithArticle({
      article: item.article,
      sourceNorma: item.sourceNorma,
      label: item.label,
    });
  };

  // Search using direct API call (same format as useCitationPreview)
  const handleSearch = useCallback(async () => {
    if (!parsedCitation || !citationReady) return;

    // Validate version date if needed
    if (version === 'data' && !versionDate) {
      setSearchError('Inserisci una data per la versione');
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setSearchResults([]);

    try {
      const params = toSearchParams(parsedCitation);

      // Build request body - direct format like useCitationPreview
      const requestBody: Record<string, string | boolean> = {
        act_type: params.act_type,
        article: params.article,
        version: version === 'data' ? 'vigente' : version,
        show_brocardi_info: false,
      };

      // Only add optional fields if they have actual values
      if (params.act_number) {
        requestBody.act_number = params.act_number;
      }
      if (params.date) {
        requestBody.date = parseItalianDate(params.date);
      }

      // Add version_date for temporal comparison
      if (version === 'data' && versionDate) {
        requestBody.version_date = parseItalianDate(versionDate);
      }

      // Direct fetch - same as useCitationPreview
      const response = await fetch('/fetch_article_text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error('Articolo non trovato');
      }

      const articles: ArticleData[] = await response.json();

      // Build version label
      let versionLabel = '';
      if (version === 'originale') {
        versionLabel = ' (originale)';
      } else if (version === 'data' && versionDate) {
        versionLabel = ` (${versionDate})`;
      }

      if (Array.isArray(articles) && articles.length > 0) {
        setSearchResults(articles.map((art, idx) => ({
          id: `search-${idx}`,
          article: art,
          sourceNorma: {
            tipo_atto: params.act_type,
            numero_atto: params.act_number,
            data: params.date,
          },
          label: `Art. ${art.norma_data.numero_articolo} - ${params.act_type}${params.act_number ? ` n. ${params.act_number}` : ''}${versionLabel}`,
          source: 'search' as const,
        })));
      } else {
        setSearchError('Nessun articolo trovato');
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Errore nella ricerca');
    } finally {
      setIsSearching(false);
    }
  }, [parsedCitation, citationReady, version, versionDate]);

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && citationReady) {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <div className={cn(
      "flex-1 flex flex-col",
      "bg-slate-50 dark:bg-slate-900/50",
      "border border-slate-200 dark:border-slate-700 rounded-xl m-2",
      "min-h-[400px] overflow-hidden"
    )}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-300 mb-3">
          {side === 'left' ? 'Seleziona primo articolo' : 'Seleziona secondo articolo'}
        </h3>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-700 rounded-lg">
          <button
            onClick={() => setActiveTab('available')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              activeTab === 'available'
                ? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            )}
          >
            <Layers size={14} />
            Dalle Tab ({availableArticles.length})
          </button>
          <button
            onClick={() => setActiveTab('search')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              activeTab === 'search'
                ? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            )}
          >
            <Search size={14} />
            Cerca
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'available' ? (
          <div className="p-2">
            {availableArticles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Layers size={32} className="text-slate-300 dark:text-slate-600 mb-3" />
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Nessun articolo aperto</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Usa la tab "Cerca" per trovare un articolo
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {availableArticles.map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleSelectArticle(item)}
                    className="w-full flex items-center gap-3 p-3 text-left rounded-lg hover:bg-white dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 transition-all group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 flex items-center justify-center font-bold text-sm shrink-0">
                      {item.article.norma_data.numero_articolo}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                        {item.label}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate flex items-center gap-1">
                        <Layers size={10} />
                        {item.tabName}
                      </p>
                    </div>
                    <ChevronRight size={16} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Search input with smart parsing */}
            <div className="space-y-2">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="es. art 2043 cc, legge 241/1990 art 1..."
                  className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  autoFocus
                />
                {isSearching && (
                  <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-primary-500 animate-spin" />
                )}
              </div>

              {/* Smart citation preview */}
              {parsedCitation && citationPreview && (
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-5 h-5 rounded-md flex items-center justify-center shrink-0",
                    citationReady ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"
                  )}>
                    <Zap size={10} fill="currentColor" />
                  </div>
                  <span className={cn(
                    "text-xs font-bold uppercase tracking-wider",
                    citationReady ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                  )}>
                    {citationPreview}
                  </span>
                  <div className="flex-1" />
                  {citationReady ? (
                    <button
                      onClick={handleSearch}
                      disabled={isSearching || (version === 'data' && !versionDate)}
                      className="px-3 py-1 text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isSearching ? 'Cercando...' : 'Cerca'}
                    </button>
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                      Completa la ricerca
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Version selector for temporal comparison */}
            <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                <Clock size={14} />
                <span>Versione dell'articolo</span>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setVersion('vigente')}
                  className={cn(
                    "flex-1 px-3 py-2 text-xs font-bold rounded-lg transition-all",
                    version === 'vigente'
                      ? "bg-primary-500 text-white shadow-sm"
                      : "bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600"
                  )}
                >
                  Vigente
                </button>
                <button
                  onClick={() => setVersion('originale')}
                  className={cn(
                    "flex-1 px-3 py-2 text-xs font-bold rounded-lg transition-all",
                    version === 'originale'
                      ? "bg-amber-500 text-white shadow-sm"
                      : "bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600"
                  )}
                >
                  Originale
                </button>
                <button
                  onClick={() => setVersion('data')}
                  className={cn(
                    "flex-1 px-3 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1",
                    version === 'data'
                      ? "bg-blue-500 text-white shadow-sm"
                      : "bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600"
                  )}
                >
                  <Calendar size={12} />
                  Data
                </button>
              </div>

              {/* Date input when "data" is selected */}
              {version === 'data' && (
                <div className="flex items-center gap-2 animate-in slide-in-from-top-2 duration-200">
                  <Calendar size={14} className="text-blue-500 shrink-0" />
                  <input
                    type="text"
                    value={versionDate}
                    onChange={(e) => setVersionDate(e.target.value)}
                    placeholder="es. 01/01/2020 o 2020"
                    className="flex-1 px-3 py-2 text-sm border border-blue-200 dark:border-blue-800 rounded-lg bg-white dark:bg-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
              )}

              <p className="text-[10px] text-slate-400">
                {version === 'vigente' && 'Testo attualmente in vigore'}
                {version === 'originale' && 'Testo originale alla data di pubblicazione'}
                {version === 'data' && 'Testo vigente alla data specificata'}
              </p>
            </div>

            {/* Search hints */}
            {!searchQuery && (
              <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-3 space-y-2">
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Esempi di ricerca:</p>
                <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <p>• <code className="bg-white dark:bg-slate-700 px-1 rounded">art 2043 cc</code> - Codice Civile</p>
                  <p>• <code className="bg-white dark:bg-slate-700 px-1 rounded">legge 241/1990 art 1</code> - Legge specifica</p>
                  <p>• <code className="bg-white dark:bg-slate-700 px-1 rounded">art 1 cost</code> - Costituzione</p>
                  <p>• <code className="bg-white dark:bg-slate-700 px-1 rounded">d.lgs 50/2016 art 36</code> - Decreto legislativo</p>
                </div>
                <p className="text-[10px] text-slate-400 mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                  Premi <kbd className="px-1 py-0.5 bg-white dark:bg-slate-700 rounded text-[9px] font-bold">Enter</kbd> per cercare
                </p>
              </div>
            )}

            {/* Search error */}
            {searchError && (
              <div className="text-center py-6 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400 font-medium">
                  {searchError}
                </p>
                <p className="text-xs text-red-500/70 dark:text-red-400/70 mt-1">
                  Verifica la sintassi della ricerca
                </p>
              </div>
            )}

            {/* Search results */}
            {searchResults.length > 0 && (
              <div className="space-y-1">
                {searchResults.map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleSelectArticle(item)}
                    className="w-full flex items-center gap-3 p-3 text-left rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-700 transition-all group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-sm shrink-0">
                      {item.article.norma_data.numero_articolo}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                        {item.label}
                      </p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <Search size={10} />
                        Risultato ricerca
                      </p>
                    </div>
                    <ChevronRight size={16} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface ArticlePanelProps {
  article: CompareArticle | null;
  side: 'left' | 'right';
  onRemove: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll?: () => void;
  isFullscreen?: boolean;
}

function ArticlePanel({ article, side, onRemove, scrollRef, onScroll, isFullscreen }: ArticlePanelProps) {
  if (!article) {
    return <ArticleSelectorPanel side={side} />;
  }

  const articleNumber = article.article.norma_data.numero_articolo;
  const allegato = article.article.norma_data.allegato;

  return (
    <div className={cn(
      "flex-1 flex flex-col min-w-0",
      "bg-white dark:bg-slate-900",
      "border border-slate-200 dark:border-slate-700 rounded-xl m-2",
      isFullscreen && "h-full"
    )}>
      {/* Panel Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 rounded-t-xl">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs",
            side === 'left'
              ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
              : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
          )}>
            {articleNumber}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                Art. {articleNumber}
              </span>
              {allegato && (
                <span className="text-xs px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded">
                  All. {allegato}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {article.label}
            </p>
          </div>
        </div>
        <button
          onClick={onRemove}
          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          title="Rimuovi dal confronto"
        >
          <X size={16} />
        </button>
      </div>

      {/* Panel Content */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto p-4 md:p-6"
      >
        <div
          className="prose prose-slate dark:prose-invert prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: article.article.article_text || '' }}
        />
      </div>
    </div>
  );
}

export function CompareView() {
  const {
    isOpen,
    leftArticle,
    rightArticle,
    syncScroll,
    close,
    swap,
    remove,
    setSyncScroll,
    isComplete,
  } = useCompare();

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef(false);

  // Handle synchronized scrolling
  const handleLeftScroll = () => {
    if (!syncScroll || isScrolling.current) return;
    if (leftScrollRef.current && rightScrollRef.current) {
      isScrolling.current = true;
      const scrollPercentage = leftScrollRef.current.scrollTop /
        (leftScrollRef.current.scrollHeight - leftScrollRef.current.clientHeight);
      rightScrollRef.current.scrollTop = scrollPercentage *
        (rightScrollRef.current.scrollHeight - rightScrollRef.current.clientHeight);
      requestAnimationFrame(() => {
        isScrolling.current = false;
      });
    }
  };

  const handleRightScroll = () => {
    if (!syncScroll || isScrolling.current) return;
    if (leftScrollRef.current && rightScrollRef.current) {
      isScrolling.current = true;
      const scrollPercentage = rightScrollRef.current.scrollTop /
        (rightScrollRef.current.scrollHeight - rightScrollRef.current.clientHeight);
      leftScrollRef.current.scrollTop = scrollPercentage *
        (leftScrollRef.current.scrollHeight - leftScrollRef.current.clientHeight);
      requestAnimationFrame(() => {
        isScrolling.current = false;
      });
    }
  };

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (isFullscreen) {
          setIsFullscreen(false);
        } else {
          close();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isFullscreen, close]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={cn(
          "fixed inset-0 bg-black/50 backdrop-blur-sm",
          Z_INDEX.compare,
          isFullscreen && "bg-slate-100 dark:bg-slate-950"
        )}
        onClick={(e) => {
          if (e.target === e.currentTarget && !isFullscreen) {
            close();
          }
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.98 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className={cn(
            "bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col",
            isFullscreen
              ? "fixed inset-0 rounded-none"
              : "fixed inset-4 md:inset-8 lg:inset-12"
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                <FileText size={20} className="text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <h2 className="font-bold text-lg text-slate-900 dark:text-white">
                  Confronto Articoli
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isComplete ? 'Visualizza le differenze tra i due articoli' : 'Seleziona due articoli per confrontarli'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Sync scroll toggle - only visible when both articles are loaded */}
              {isComplete && (
                <button
                  onClick={() => setSyncScroll(!syncScroll)}
                  className={cn(
                    "p-2 rounded-lg transition-colors hidden md:flex items-center",
                    syncScroll
                      ? "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                      : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  )}
                  title={syncScroll ? 'Scroll sincronizzato attivo - clicca per disattivare' : 'Attiva scroll sincronizzato'}
                >
                  {syncScroll ? <Link2 size={16} /> : <Link2Off size={16} />}
                </button>
              )}

              {/* Swap articles */}
              {isComplete && (
                <button
                  onClick={swap}
                  className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                  title="Inverti articoli"
                >
                  <ArrowLeftRight size={16} />
                </button>
              )}

              {/* Show diff toggle */}
              {isComplete && (
                <button
                  onClick={() => setShowDiff(!showDiff)}
                  className={cn(
                    "px-3 py-2 rounded-lg transition-colors text-sm font-medium hidden md:block",
                    showDiff
                      ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                  )}
                >
                  {showDiff ? 'Nascondi Diff' : 'Mostra Diff'}
                </button>
              )}

              {/* Fullscreen toggle */}
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                title={isFullscreen ? 'Esci da schermo intero' : 'Schermo intero'}
              >
                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>

              {/* Close button */}
              <button
                onClick={close}
                className="p-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {showDiff && isComplete && leftArticle && rightArticle ? (
              <div className="flex-1 overflow-y-auto p-4 md:p-6">
                <ArticleDiff
                  leftText={stripHtml(leftArticle.article.article_text || '')}
                  rightText={stripHtml(rightArticle.article.article_text || '')}
                  leftLabel={leftArticle.label}
                  rightLabel={rightArticle.label}
                />
              </div>
            ) : (
              <>
                <ArticlePanel
                  article={leftArticle}
                  side="left"
                  onRemove={() => remove('left')}
                  scrollRef={leftScrollRef}
                  onScroll={handleLeftScroll}
                  isFullscreen={isFullscreen}
                />

                {/* Divider */}
                <div className="hidden md:flex w-px bg-slate-200 dark:bg-slate-700 relative">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                    <ArrowLeftRight size={14} className="text-slate-400" />
                  </div>
                </div>

                <ArticlePanel
                  article={rightArticle}
                  side="right"
                  onRemove={() => remove('right')}
                  scrollRef={rightScrollRef}
                  onScroll={handleRightScroll}
                  isFullscreen={isFullscreen}
                />
              </>
            )}
          </div>

        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
