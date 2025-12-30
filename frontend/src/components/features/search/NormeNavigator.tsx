import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Compass, Book, ChevronRight, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { Norma, ArticleData } from '../../../types';
import { formatDateItalianLong, abbreviateActType } from '../../../utils/dateUtils';

interface NormeNavigatorProps {
  norme: Array<{ norma: Norma; articles: ArticleData[]; versionDate?: string }>;
  onNavigateToNorma: (index: number) => void;
  className?: string;
}

export function NormeNavigator({ norme, onNavigateToNorma, className }: NormeNavigatorProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (norme.length === 0) return null;

  return (
    <div className={cn("fixed right-4 top-24 z-30", className)}>
      <AnimatePresence>
        {isExpanded ? (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl border-2 border-slate-200 dark:border-slate-700 overflow-hidden"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-50 to-blue-50/50 dark:from-blue-900/20 dark:to-blue-900/10 p-3 border-b border-blue-200 dark:border-blue-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Compass size={16} className="text-blue-600 dark:text-blue-400" />
                <span className="font-bold text-sm text-slate-900 dark:text-white">Navigator</span>
                <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full font-medium">
                  {norme.length}
                </span>
              </div>
              <button
                onClick={() => setIsExpanded(false)}
                className="p-1 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-md transition-colors text-slate-500 dark:text-slate-400"
              >
                <X size={14} />
              </button>
            </div>

            {/* Norme List */}
            <div className="max-h-[500px] overflow-y-auto p-2 space-y-1">
              {norme.map((item, index) => {
                const norma = item.norma;
                const articleCount = item.articles.length;

                return (
                  <button
                    key={index}
                    onClick={() => {
                      onNavigateToNorma(index);
                      setIsExpanded(false);
                    }}
                    className={cn(
                      "w-full text-left p-3 rounded-lg transition-all group",
                      "hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-700",
                      "border-2 border-transparent"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                        <Book size={14} className="text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                          {norma.tipo_atto}
                          {/* Show number only if NOT an alias */}
                          {!norma.tipo_atto_reale && norma.numero_atto && ` n. ${norma.numero_atto}`}
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {norma.tipo_atto_reale ? (
                            // For aliases: show abbreviated real type + date + number
                            <>
                              {abbreviateActType(norma.tipo_atto_reale)}
                              {norma.data && ` ${formatDateItalianLong(norma.data)}`}
                              {norma.numero_atto && `, n. ${norma.numero_atto}`}
                            </>
                          ) : (
                            // For regular norms: just show date
                            norma.data ? formatDateItalianLong(norma.data) : 'Data non disponibile'
                          )}
                        </p>
                        <div className="flex items-center gap-1 mt-1">
                          <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-full font-medium">
                            {articleCount} {articleCount === 1 ? 'articolo' : 'articoli'}
                          </span>
                        </div>
                      </div>
                      <ChevronRight size={14} className="text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors shrink-0" />
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        ) : (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsExpanded(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-xl shadow-lg flex items-center gap-2 font-medium text-sm"
            title={`Naviga ${norme.length} ${norme.length === 1 ? 'norma' : 'norme'}`}
          >
            <Compass size={18} />
            <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs font-bold">
              {norme.length}
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
