import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Plus, FileText, FolderOpen } from 'lucide-react';
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

  // Numeric articles with optional suffix: "1", "2", "1-bis", "2 bis", "3-ter", "4 quater"
  if (/^(\d+)(?:[-\s]?(bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?$/i.test(trimmed)) {
    return true;
  }

  // Roman numerals with optional suffix: "I", "II", "III", "I-bis", "II ter"
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
  let currentSection: ParsedSection = { title: '', articles: [] };

  for (const item of data) {
    if (typeof item !== 'string') continue;

    if (isArticleString(item)) {
      currentSection.articles.push(item);
    } else {
      // It's a section title
      if (currentSection.articles.length > 0 || currentSection.title) {
        sections.push(currentSection);
      }
      currentSection = { title: item, articles: [] };
    }
  }

  // Push last section
  if (currentSection.articles.length > 0 || currentSection.title) {
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
          "relative px-2.5 py-1 text-sm font-medium rounded-md transition-all",
          isLoaded
            ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 cursor-default"
            : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:text-blue-700 dark:hover:text-blue-400 cursor-pointer"
        )}
        title={isLoaded ? `Art. ${articleNum} (già caricato)` : `Carica Art. ${articleNum}`}
      >
        {articleNum}
        {isLoaded && (
          <Check size={10} className="absolute -top-1 -right-1 text-green-600 dark:text-green-400" />
        )}
      </button>
    );
  };

  // Render flat structure with sections
  const renderFlatStructure = () => {
    if (!parsedSections) return null;

    return (
      <div className="space-y-4">
        {parsedSections.map((section, idx) => (
          <div key={idx} className="space-y-2">
            {/* Section Title */}
            {section.title && (
              <div className="flex items-start gap-2 py-2 border-b border-gray-200 dark:border-gray-700">
                <FolderOpen size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white leading-tight">
                  {section.title}
                </h4>
              </div>
            )}

            {/* Articles Grid */}
            {section.articles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pl-6">
                {section.articles.map(renderArticleButton)}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  // Legacy: Render nested object tree nodes
  const renderTreeNodes = (nodes: any, depth = 0): React.ReactElement | null => {
    if (!nodes) return null;

    const list = Array.isArray(nodes) ? nodes : Object.values(nodes);

    return (
      <ul className={cn(
        'space-y-1 text-gray-600 dark:text-gray-300',
        depth > 0 && 'ml-4 text-xs border-l border-gray-200 dark:border-gray-700 pl-3'
      )}>
        {list.map((node: any, idx: number) => {
          const label = node?.title || node?.label || node?.name || node?.numero || `Nodo ${idx + 1}`;
          const children = node?.children || node?.items || node?.articoli;
          const articleNum = node?.numero || null;
          const isLoaded = articleNum ? isArticleLoaded(articleNum) : false;
          const isClickable = articleNum && onArticleSelect && !isLoaded;

          return (
            <li key={node?.id || idx}>
              <div
                className={cn(
                  "flex items-start gap-2 group py-0.5",
                  isClickable && "cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded px-1 -mx-1 transition-colors",
                  isLoaded && "opacity-60"
                )}
                onClick={() => {
                  if (isClickable && articleNum) {
                    onArticleSelect(articleNum);
                  }
                }}
              >
                <span className={cn(
                  "mt-1.5 rounded-full flex-shrink-0",
                  depth === 0 ? "w-2 h-2 bg-blue-500" : "w-1.5 h-1.5 bg-gray-400 dark:bg-gray-600",
                  isLoaded && "bg-green-500"
                )} />
                <span className={cn(
                  "leading-relaxed flex-1",
                  depth === 0 && "font-medium text-gray-900 dark:text-white",
                  isClickable && "text-blue-600 dark:text-blue-400"
                )}>
                  {label}
                </span>
                {articleNum && (
                  <span className="flex-shrink-0">
                    {isLoaded ? (
                      <Check size={14} className="text-green-500" />
                    ) : onArticleSelect && (
                      <Plus size={14} className="text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </span>
                )}
              </div>
              {children && renderTreeNodes(children, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
          />

          {/* Side Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-96 bg-white dark:bg-gray-900 shadow-2xl z-50 overflow-y-auto border-l border-gray-200 dark:border-gray-800"
          >
            {/* Sticky Header */}
            <div className="sticky top-0 bg-white/90 dark:bg-gray-900/90 backdrop-blur border-b border-gray-200 dark:border-gray-800 px-6 py-4 z-10">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-lg text-gray-900 dark:text-white">{title}</h3>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              {/* Stats */}
              {stats && (
                <div className="flex items-center gap-3 mt-2 text-xs">
                  <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                    <FileText size={12} />
                    {stats.total} articoli
                  </span>
                  {stats.loaded > 0 && (
                    <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                      <Check size={12} />
                      {stats.loaded} caricati
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Content */}
            <div className="p-6">
              {treeData && treeData.length > 0 ? (
                isFlatStringArray ? renderFlatStructure() : renderTreeNodes(treeData)
              ) : (
                <div className="text-center py-10">
                  <p className="text-gray-500 dark:text-gray-400 text-sm">
                    Struttura non disponibile
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
