import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, FileText, FolderOpen, List, Layers } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { AnnexMetadata } from '../../../types';
import { useTour } from '../../../hooks/useTour';

// Normalize article ID for comparison (handles "3 bis" vs "3-bis")
function normalizeArticleId(id: string): string {
  if (!id) return id;
  return id.trim().toLowerCase().replace(/\s+/g, '-');
}

export interface TreeViewPanelProps {
  isOpen: boolean;
  onClose: () => void;
  treeData: any[];
  urn: string;
  title?: string;
  /** Callback when article is selected - includes target annex (null for dispositivo) */
  onArticleSelect?: (articleNumber: string, targetAnnex: string | null) => void;
  loadedArticles?: string[];
  /** Annex metadata for tabs - if provided, shows annex tabs */
  annexes?: AnnexMetadata[];
  /** Currently selected annex (from loaded articles) */
  currentAnnex?: string | null;
}

// Check if a string is an article number (numeric or roman numeral)
function isArticleString(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  const trimmed = str.trim();

  // Numeric articles: "1", "2", "1-bis", "2 bis", "3-ter", "4 quater"
  if (/^(\d+)(?:[-\s]?(bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?$/i.test(trimmed)) {
    return true;
  }

  // Roman numerals: "I", "II", "III", "I-bis", "II ter"
  if (/^([IVXLCDM]+)(?:[-\s]?(bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?$/i.test(trimmed)) {
    return true;
  }

  return false;
}

// Parse tree data into structured sections
// Handles both flat string arrays ["1", "2", ...] and object arrays [{allegato, numero}, ...]
interface ParsedSection {
  title: string;
  articles: string[];
}

/**
 * Parse tree data filtering by a specific annex.
 * The tree contains a mix of:
 * - Objects: {allegato: null|"1"|"2", numero: "X"} - articles with their annex
 * - Strings: Section titles like "LIBRO PRIMO...", "TITOLO II...", "CAPO I..."
 *
 * Section titles are applied to following articles, but only sections with
 * articles matching the target annex are included.
 */
function parseTreeDataForAnnex(data: any[], targetAnnex: string | null): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection = { title: 'Articoli', articles: [] };
  let pendingSectionTitle: string | null = null;

  for (const item of data) {
    // Handle string items (section titles or legacy article numbers)
    if (typeof item === 'string') {
      if (isArticleString(item)) {
        // Legacy format: plain article number string (no annex info)
        // Only include if targeting dispositivo (null annex)
        if (targetAnnex === null) {
          if (pendingSectionTitle && pendingSectionTitle !== currentSection.title) {
            if (currentSection.articles.length > 0) {
              sections.push(currentSection);
            }
            currentSection = { title: pendingSectionTitle, articles: [] };
            pendingSectionTitle = null;
          }
          currentSection.articles.push(item);
        }
      } else {
        // It's a section title - store it for when we find matching articles
        pendingSectionTitle = item;
      }
      continue;
    }

    // Handle object items (article data with allegato info)
    if (item && typeof item === 'object' && item.numero !== undefined) {
      const itemAnnex = item.allegato ?? null;

      // Check if this article belongs to the target annex
      // Compare with type coercion: null === null, "1" === "1"
      const annexMatches = (itemAnnex === null && targetAnnex === null) ||
                           (itemAnnex !== null && targetAnnex !== null && String(itemAnnex) === String(targetAnnex));

      if (annexMatches) {
        // Create new section if we have a pending title
        if (pendingSectionTitle && pendingSectionTitle !== currentSection.title) {
          if (currentSection.articles.length > 0) {
            sections.push(currentSection);
          }
          currentSection = { title: pendingSectionTitle, articles: [] };
          pendingSectionTitle = null;
        }
        currentSection.articles.push(item.numero);
      }
      continue;
    }
  }

  // Push last section
  if (currentSection.articles.length > 0) {
    sections.push(currentSection);
  }

  return sections;
}

export function TreeViewPanel({
  isOpen,
  onClose,
  treeData,
  title = 'Struttura Atto',
  onArticleSelect,
  loadedArticles = [],
  annexes,
  currentAnnex
}: TreeViewPanelProps) {
  // Track which annex tab is selected in the UI
  // This is separate from currentAnnex (which reflects loaded articles)
  // Allows user to select a tab and click articles before loading completes
  const [selectedAnnex, setSelectedAnnex] = useState<string | null | undefined>(undefined);
  const { tryStartTour } = useTour();

  // Start tree view tour on first open
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => tryStartTour('treeView'), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, tryStartTour]);

  // Reset selected annex when panel opens or when currentAnnex changes externally
  useEffect(() => {
    setSelectedAnnex(undefined);
  }, [currentAnnex, isOpen]);

  // The annex to use for display and article clicks
  // If user selected a tab, use that; otherwise use the loaded annex
  const effectiveAnnex = selectedAnnex !== undefined ? selectedAnnex : currentAnnex;

  // Show annexes section if we have multiple annexes
  const showAnnexes = annexes && annexes.length > 1;

  // Handle annex tab click - just change the view, don't load articles
  // User will click on a specific article to load it
  const handleAnnexTabClick = (annexNumber: string | null) => {
    // Skip if already on this annex
    if (annexNumber === effectiveAnnex) return;

    // Just update the selected tab - this changes which articles are displayed
    // No article is loaded until user clicks one
    setSelectedAnnex(annexNumber);
  };
  // Parse tree data into sections filtered by current annex
  // This ensures each annex tab shows its own section structure (titles/chapters)
  const parsedSections = useMemo(() => {
    if (treeData && treeData.length > 0) {
      return parseTreeDataForAnnex(treeData, effectiveAnnex ?? null);
    }
    return null;
  }, [treeData, effectiveAnnex]);

  // Get articles for the currently selected annex from metadata
  // This ensures we show the correct articles for each annex tab
  const articlesForCurrentAnnex = useMemo(() => {
    if (!annexes || annexes.length === 0) return null;

    // Find the annex matching effectiveAnnex
    const currentAnnexInfo = annexes.find(a =>
      a.number === effectiveAnnex ||
      (a.number === null && effectiveAnnex === null)
    );

    if (currentAnnexInfo?.article_numbers && currentAnnexInfo.article_numbers.length > 0) {
      return currentAnnexInfo.article_numbers;
    }

    return null;
  }, [annexes, effectiveAnnex]);

  // Check if parsedSections has actual structure (titles/chapters, not just one generic section)
  const hasStructuredSections = parsedSections && (
    parsedSections.length > 1 ||
    (parsedSections.length === 1 && parsedSections[0].title !== 'Articoli')
  );

  // Determine display mode:
  // - Prefer structured view (with titles/chapters) when available for ANY annex
  // - Fall back to flat article list only when no section structure exists
  const useStructuredView = hasStructuredSections;
  const displayArticles = useStructuredView ? null : articlesForCurrentAnnex;
  const useFallbackTree = !displayArticles && parsedSections;

  // Count stats based on what we're displaying
  const stats = useMemo(() => {
    if (displayArticles) {
      return { total: displayArticles.length, loaded: loadedArticles.length };
    }
    if (parsedSections) {
      const totalArticles = parsedSections.reduce((sum, s) => sum + s.articles.length, 0);
      return { total: totalArticles, loaded: loadedArticles.length };
    }
    return null;
  }, [displayArticles, parsedSections, loadedArticles]);

  // Create normalized set for comparison
  const loadedSetNormalized = useMemo(
    () => new Set(loadedArticles.map(normalizeArticleId)),
    [loadedArticles]
  );
  const isArticleLoaded = (id: string) => loadedSetNormalized.has(normalizeArticleId(id));

  // Render article button with section index for unique keys
  const renderArticleButton = (articleNum: string, sectionIdx: number, articleIdx: number) => {
    // Build unique ID with current annex context to check if THIS specific article is loaded
    // e.g., Allegato 1 Art. 1 = "all1:1", Dispositivo Art. 1 = "1"
    const uniqueIdForContext = effectiveAnnex
      ? `all${effectiveAnnex}:${articleNum}`
      : articleNum;
    const isLoaded = isArticleLoaded(uniqueIdForContext);
    const isClickable = onArticleSelect && !isLoaded;
    // Create unique key: section index + article index + article number
    const uniqueKey = `sec${sectionIdx}-art${articleIdx}-${articleNum}`;

    return (
      <motion.button
        key={uniqueKey}
        onClick={() => isClickable && onArticleSelect(articleNum, effectiveAnnex ?? null)}
        disabled={!isClickable}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: articleIdx * 0.02, duration: 0.2 }}
        whileHover={isClickable ? { scale: 1.05, y: -2 } : {}}
        whileTap={isClickable ? { scale: 0.95 } : {}}
        className={cn(
          "relative px-4 py-2.5 text-xs font-bold rounded-xl transition-colors border",
          isLoaded
            ? "bg-gradient-to-br from-emerald-50 to-emerald-100/50 border-emerald-200 text-emerald-700 dark:from-emerald-900/30 dark:to-emerald-900/10 dark:border-emerald-800/50 dark:text-emerald-400 cursor-default shadow-inner"
            : "bg-white border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 hover:border-primary-400 dark:hover:border-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/40 hover:text-primary-600 dark:hover:text-primary-400 cursor-pointer shadow-sm hover:shadow-md"
        )}
      >
        {articleNum}
        <AnimatePresence>
          {isLoaded && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              className="absolute -top-1.5 -right-1.5"
            >
              <div className="w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center shadow-md shadow-emerald-500/30 ring-2 ring-white dark:ring-slate-900">
                <Check size={10} className="text-white" strokeWidth={3} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    );
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop with Glass effect */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-[100]"
          />

          {/* Sidebar Side Panel */}
          <motion.aside
            initial={{ x: '100%', opacity: 0.9 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0.9 }}
            transition={{ type: 'spring', damping: 35, stiffness: 400 }}
            className="fixed right-0 top-0 bottom-0 w-full sm:w-[450px] bg-white dark:bg-slate-900 shadow-2xl z-[100] flex flex-col border-l border-slate-200 dark:border-slate-800"
          >
            {/* Header with Glass-like effect */}
            <div className="sticky top-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800 px-6 py-5 z-10">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 dark:text-primary-400 shadow-sm border border-primary-200/50 dark:border-primary-800/50">
                    <List size={22} />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-slate-900 dark:text-white leading-tight uppercase tracking-tight">{title}</h3>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Indice Strutturale</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-all border border-transparent hover:border-slate-200 dark:hover:border-slate-700 shadow-sm"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Enhanced Stats */}
              {stats && (
                <div id="tour-tree-stats" className="flex items-center gap-4">
                  <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center gap-2">
                    <FileText size={14} className="text-slate-500" />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {stats.total} <span className="opacity-60 font-medium">Articoli totali</span>
                    </span>
                  </div>
                  <div className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg flex items-center gap-2 border border-emerald-100/50 dark:border-emerald-800/30">
                    <Check size={14} className="text-emerald-500" />
                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      {stats.loaded} <span className="opacity-60 font-medium uppercase text-[10px]">Caricati</span>
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Annex Tabs - Show when multiple annexes exist */}
            {showAnnexes && (
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-gradient-to-b from-slate-50/80 to-white dark:from-slate-800/50 dark:to-slate-900">
                <div className="flex items-center gap-2 mb-3">
                  <Layers size={14} className="text-primary-500" />
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                    Sezioni documento
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {annexes!.map((annex) => {
                    const isActive = effectiveAnnex === annex.number ||
                      (effectiveAnnex === null && annex.number === null);

                    return (
                      <motion.button
                        key={annex.number ?? 'main'}
                        onClick={() => handleAnnexTabClick(annex.number)}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        layout
                        className={cn(
                          "relative px-3 py-2 text-xs font-semibold rounded-xl transition-colors border overflow-hidden",
                          isActive
                            ? "bg-gradient-to-br from-primary-500 to-primary-600 text-white border-primary-500 shadow-lg shadow-primary-500/25"
                            : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-600 hover:text-primary-600 dark:hover:text-primary-400 hover:shadow-md"
                        )}
                      >
                        {/* Active indicator glow */}
                        {isActive && (
                          <motion.div
                            layoutId="annexActiveGlow"
                            className="absolute inset-0 bg-gradient-to-br from-primary-400/20 to-transparent"
                            transition={{ type: 'spring', damping: 30, stiffness: 400 }}
                          />
                        )}
                        <span className="relative block truncate max-w-[140px]">{annex.label}</span>
                        <span className={cn(
                          "relative text-[10px] block mt-0.5 font-medium",
                          isActive ? "text-primary-100" : "text-slate-400 dark:text-slate-500"
                        )}>
                          {annex.article_count} articoli
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Scrollable Content */}
            <div id="tour-tree-structure" className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {/* Show annex-specific articles when available */}
              {displayArticles ? (
                <motion.div
                  key={effectiveAnnex ?? 'dispositivo'}
                  className="pb-10"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {/* Section header for current annex */}
                  <div className="flex items-start gap-3 mb-6">
                    <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                      <FileText size={16} className="text-primary-600 dark:text-primary-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug">
                        {annexes?.find(a => a.number === effectiveAnnex || (a.number === null && effectiveAnnex === null))?.label || 'Articoli'}
                      </h4>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium mt-0.5">
                        {displayArticles.length} articoli disponibili
                      </p>
                    </div>
                  </div>

                  {/* Articles Grid */}
                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-2.5">
                    {displayArticles.map((articleNum, artIdx) => renderArticleButton(articleNum, 0, artIdx))}
                  </div>
                </motion.div>
              ) : useFallbackTree ? (
                <motion.div
                  className="space-y-8 pb-10"
                  initial="hidden"
                  animate="visible"
                  variants={{
                    visible: { transition: { staggerChildren: 0.05 } }
                  }}
                >
                  {parsedSections!.map((section, idx) => (
                    <motion.div
                      key={idx}
                      className="space-y-4"
                      variants={{
                        hidden: { opacity: 0, y: 10 },
                        visible: { opacity: 1, y: 0 }
                      }}
                      transition={{ duration: 0.3 }}
                    >
                      {/* Section Title */}
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                          <FolderOpen size={16} className="text-amber-600 dark:text-amber-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug">
                            {section.title}
                          </h4>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium mt-0.5">
                            {section.articles.length} articoli
                          </p>
                        </div>
                      </div>

                      {/* Articles Grid - More compact/modern grid */}
                      <div className="grid grid-cols-4 sm:grid-cols-5 gap-2.5 pl-11">
                        {section.articles.map((articleNum, artIdx) => renderArticleButton(articleNum, idx, artIdx))}
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center py-20 text-slate-400"
                >
                  <List size={48} className="opacity-20 mb-4" />
                  <p className="text-sm font-medium">Struttura non ancora disponibile</p>
                </motion.div>
              )}
            </div>

            {/* Footer shadow fade */}
            <div className="h-10 bg-gradient-to-t from-white dark:from-slate-900 to-transparent pointer-events-none sticky bottom-0" />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
