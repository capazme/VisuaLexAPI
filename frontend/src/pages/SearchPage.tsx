import { SearchPanel } from '../components/features/search/SearchPanel';
import { useAppStore } from '../store/useAppStore';
import { ArticleTabContent } from '../components/features/search/ArticleTabContent';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

export function SearchPage() {
  const { settings, comparisonArticle, clearComparisonArticle } = useAppStore();

  const showSplitView = settings.splitView && !!comparisonArticle;

  return (
    <div className={cn(
      'w-full',
      showSplitView ? 'grid grid-cols-1 xl:grid-cols-2 gap-6' : ''
    )}>
      <div className={cn(showSplitView && 'xl:col-span-1')}>
        <SearchPanel />
      </div>

      {showSplitView && comparisonArticle && (
        <div className="xl:col-span-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden flex flex-col animate-in fade-in duration-300">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Vista Comparata</p>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {comparisonArticle.norma_data.tipo_atto} — Art. {comparisonArticle.norma_data.numero_articolo}
              </h3>
            </div>
            <button
              onClick={clearComparisonArticle}
              className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
              title="Chiudi vista comparata"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <ArticleTabContent data={comparisonArticle} />
          </div>
        </div>
      )}
    </div>
  );
}


