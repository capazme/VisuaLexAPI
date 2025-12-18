import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, FileText, FolderOpen, List } from 'lucide-react';
import { cn } from '../../../lib/utils';

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
  onArticleSelect?: (articleNumber: string) => void;
  loadedArticles?: string[];
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

// Parse flat string array into structured sections
interface ParsedSection {
  title: string;
  articles: string[];
}

function parseFlatTreeData(data: any[]): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection = { title: 'Dispositivo', articles: [] };

  for (const item of data) {
    if (typeof item !== 'string') continue;

    if (isArticleString(item)) {
      currentSection.articles.push(item);
    } else {
      // It's a section title
      if (currentSection.articles.length > 0) {
        sections.push(currentSection);
      }
      currentSection = { title: item, articles: [] };
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
  loadedArticles = []
}: TreeViewPanelProps) {
  // Check if data is flat string array
  const isFlatStringArray = useMemo(() => {
    return treeData && treeData.length > 0 && typeof treeData[0] === 'string';
  }, [treeData]);

  // Parse flat data into sections
  const parsedSections = useMemo(() => {
    if (isFlatStringArray) {
      return parseFlatTreeData(treeData);
    }
    return null;
  }, [treeData, isFlatStringArray]);

  // Count stats
  const stats = useMemo(() => {
    if (!parsedSections) return null;
    const totalArticles = parsedSections.reduce((sum, s) => sum + s.articles.length, 0);
    const loadedCount = loadedArticles.length;
    return { total: totalArticles, loaded: loadedCount };
  }, [parsedSections, loadedArticles]);

  // Create normalized set for comparison
  const loadedSetNormalized = useMemo(
    () => new Set(loadedArticles.map(normalizeArticleId)),
    [loadedArticles]
  );
  const isArticleLoaded = (id: string) => loadedSetNormalized.has(normalizeArticleId(id));

  // Render article button
  const renderArticleButton = (articleNum: string) => {
    const isLoaded = isArticleLoaded(articleNum);
    const isClickable = onArticleSelect && !isLoaded;

    return (
      <button
        key={articleNum}
        onClick={() => isClickable && onArticleSelect(articleNum)}
        disabled={!isClickable}
        className={cn(
          "relative px-4 py-2 text-xs font-bold rounded-xl transition-all border",
          isLoaded
            ? "bg-emerald-50 border-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800/50 dark:text-emerald-400 cursor-default"
            : "bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 hover:border-primary-300 dark:hover:border-primary-700 hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:text-primary-700 dark:hover:text-primary-400 cursor-pointer shadow-sm active:scale-95"
        )}
      >
        {articleNum}
        {isLoaded && (
          <Check size={10} className="absolute -top-1 -right-1 text-emerald-600 bg-emerald-100 rounded-full p-0.5 border border-white dark:border-slate-900" />
        )}
      </button>
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
            className="fixed right-0 top-0 bottom-0 w-full sm:w-[450px] bg-white dark:bg-slate-900 shadow-2xl z-[101] flex flex-col border-l border-slate-200 dark:border-slate-800"
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
                <div className="flex items-center gap-4">
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

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {parsedSections ? (
                <div className="space-y-8 pb-10">
                  {parsedSections.map((section, idx) => (
                    <div key={idx} className="space-y-4">
                      {/* Section Title */}
                      <div className="flex items-start gap-4">
                        <div className="mt-1 flex-shrink-0">
                          <FolderOpen size={18} className="text-amber-500/80" />
                        </div>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug flex-1">
                          {section.title}
                        </h4>
                      </div>

                      {/* Articles Grid - More compact/modern grid */}
                      <div className="grid grid-cols-4 sm:grid-cols-5 gap-3 pl-8">
                        {section.articles.map(renderArticleButton)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                  <List size={48} className="opacity-20 mb-4" />
                  <p className="text-sm font-medium">Struttura non ancora disponibile per questa norma</p>
                </div>
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
