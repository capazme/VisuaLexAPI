import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, ChevronDown, ChevronRight, FileText, Layers } from 'lucide-react';
import { useGlobalSearch, setGlobalHighlight } from '../../../hooks/useGlobalSearch';
import { useAppStore } from '../../../store/useAppStore';

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GlobalSearch({ isOpen, onClose }: GlobalSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { query, setQuery, groupedResults, searchResults, hasResults, clearQuery } = useGlobalSearch();
  const bringTabToFront = useAppStore((state) => state.bringTabToFront);
  const [expandedTabs, setExpandedTabs] = useState<Set<string>>(new Set());

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Update global highlight when query changes
  useEffect(() => {
    if (query.length >= 2) {
      setGlobalHighlight(query);
    } else {
      setGlobalHighlight(null);
    }

    return () => {
      setGlobalHighlight(null);
    };
  }, [query]);

  const handleClose = () => {
    clearQuery();
    onClose();
  };

  const toggleTabExpanded = (tabId: string) => {
    setExpandedTabs((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) {
        next.delete(tabId);
      } else {
        next.add(tabId);
      }
      return next;
    });
  };

  const handleMatchClick = (tabId: string) => {
    bringTabToFront(tabId);
  };

  // Expand all tabs by default when results change
  useEffect(() => {
    if (groupedResults.length > 0) {
      setExpandedTabs(new Set(groupedResults.map((g) => g.tabId)));
    }
  }, [groupedResults]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
        onClick={handleClose}
      >
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed top-24 left-1/2 -translate-x-1/2 w-full max-w-xl px-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            {/* Search Input */}
            <div className="flex items-center gap-3 p-4 border-b border-slate-100 dark:border-slate-800">
              <Search size={20} className="text-slate-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cerca negli articoli aperti..."
                className="flex-1 bg-transparent border-none outline-none text-slate-900 dark:text-white placeholder:text-slate-400 text-base"
              />
              {query && (
                <button
                  onClick={clearQuery}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                >
                  <X size={16} className="text-slate-400" />
                </button>
              )}
              <button
                onClick={handleClose}
                className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded"
              >
                ESC
              </button>
            </div>

            {/* Results */}
            {query.length >= 2 && (
              <div className="max-h-[60vh] overflow-y-auto">
                {!hasResults ? (
                  <div className="p-8 text-center">
                    <Search size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Nessun risultato per "{query}"
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                      Prova con termini diversi
                    </p>
                  </div>
                ) : (
                  <div className="p-2">
                    {/* Summary */}
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                      <FileText size={14} />
                      <span>
                        {searchResults.totalMatches} risultat{searchResults.totalMatches === 1 ? 'o' : 'i'} in{' '}
                        {groupedResults.length} tab
                      </span>
                    </div>

                    {/* Grouped Results */}
                    <div className="space-y-1">
                      {groupedResults.map((group) => {
                        const isExpanded = expandedTabs.has(group.tabId);
                        return (
                          <div key={group.tabId} className="rounded-lg overflow-hidden">
                            {/* Tab Header */}
                            <button
                              onClick={() => toggleTabExpanded(group.tabId)}
                              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                            >
                              {isExpanded ? (
                                <ChevronDown size={14} className="text-slate-400" />
                              ) : (
                                <ChevronRight size={14} className="text-slate-400" />
                              )}
                              <Layers size={14} className="text-blue-500" />
                              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate flex-1 text-left">
                                {group.tabLabel}
                              </span>
                              <span className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                                {group.matches.length}
                              </span>
                            </button>

                            {/* Matches */}
                            {isExpanded && (
                              <div className="pl-8 pr-2 pb-2 space-y-1">
                                {group.matches.slice(0, 10).map((match, idx) => (
                                  <button
                                    key={`${match.articleId}-${idx}`}
                                    onClick={() => handleMatchClick(group.tabId)}
                                    className="w-full text-left p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                  >
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                                        Art. {match.articleId}
                                      </span>
                                      <span className="text-xs text-slate-400">
                                        {match.normaLabel}
                                      </span>
                                    </div>
                                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                                      <HighlightedText text={match.matchText} query={query} />
                                    </p>
                                  </button>
                                ))}
                                {group.matches.length > 10 && (
                                  <p className="text-xs text-slate-400 px-2 py-1">
                                    +{group.matches.length - 10} altri risultati
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Hint */}
            {query.length < 2 && (
              <div className="p-6 text-center">
                <Search size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Cerca testo in tutti gli articoli aperti
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  Digita almeno 2 caratteri per cercare
                </p>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// Helper component to highlight matches
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;

  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));

  return (
    <>
      {parts.map((part, i) => {
        if (part.toLowerCase() === query.toLowerCase()) {
          return (
            <mark
              key={i}
              className="bg-amber-200 dark:bg-amber-500/30 text-amber-900 dark:text-amber-200 px-0.5 rounded"
            >
              {part}
            </mark>
          );
        }
        return part;
      })}
    </>
  );
}

// Export for highlighting in article content
export function highlightSearchQuery(
  html: string,
  query: string | null
): string {
  if (!query || query.length < 2) return html;

  // Create a regex that matches the query case-insensitively
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');

  // We need to be careful not to replace text inside HTML tags
  // This is a simplified approach - for production, use a proper HTML parser
  const parts = html.split(/(<[^>]+>)/);

  return parts
    .map((part) => {
      // If it's an HTML tag, don't modify it
      if (part.startsWith('<') && part.endsWith('>')) {
        return part;
      }
      // Otherwise, highlight matches
      return part.replace(
        regex,
        '<mark class="bg-amber-200 dark:bg-amber-500/30 text-amber-900 dark:text-amber-200 px-0.5 rounded">$1</mark>'
      );
    })
    .join('');
}
