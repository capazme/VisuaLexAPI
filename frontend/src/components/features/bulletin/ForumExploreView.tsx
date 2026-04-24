import { Search, Share2, Filter, ChevronDown, RefreshCw, Users, TrendingUp, Clock } from 'lucide-react';
import { SharedEnvironmentCard } from './SharedEnvironmentCard';
import type { SharedEnvironment, EnvironmentCategory } from '../../../types';

export type SortOption = 'newest' | 'popular' | 'mostDownloaded';

const SORT_OPTIONS: { value: SortOption; label: string; icon: React.ReactNode }[] = [
  { value: 'newest', label: 'Più recenti', icon: <Clock size={14} /> },
  { value: 'popular', label: 'Più popolari', icon: <TrendingUp size={14} /> },
  { value: 'mostDownloaded', label: 'Più scaricati', icon: <Users size={14} /> },
];

const CATEGORY_OPTIONS: { value: EnvironmentCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'Tutte le categorie' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'civil', label: 'Civile' },
  { value: 'penal', label: 'Penale' },
  { value: 'administrative', label: 'Amministrativo' },
  { value: 'eu', label: 'Europeo' },
  { value: 'other', label: 'Altro' },
];

interface ForumExploreViewProps {
  environments: SharedEnvironment[];
  pagination: { page: number; pages: number; total: number };
  loading: boolean;
  likingIds: Set<string>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  category: EnvironmentCategory | 'all';
  setCategory: (category: EnvironmentCategory | 'all') => void;
  sort: SortOption;
  setSort: (sort: SortOption) => void;
  showCategoryDropdown: boolean;
  setShowCategoryDropdown: (show: boolean) => void;
  showSortDropdown: boolean;
  setShowSortDropdown: (show: boolean) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  onRefresh: () => void;
  onPaginate: (page: number) => void;
  onLike: (id: string) => void;
  onImport: (env: SharedEnvironment) => void;
  onReport: (id: string) => void;
  onSuggest: (env: SharedEnvironment) => void;
  onPublishClick: () => void;
}

export function ForumExploreView({
  environments,
  pagination,
  loading,
  likingIds,
  searchQuery,
  setSearchQuery,
  category,
  setCategory,
  sort,
  setSort,
  showCategoryDropdown,
  setShowCategoryDropdown,
  showSortDropdown,
  setShowSortDropdown,
  onSearchSubmit,
  onRefresh,
  onPaginate,
  onLike,
  onImport,
  onReport,
  onSuggest,
  onPublishClick,
}: ForumExploreViewProps) {
  const selectedSort = SORT_OPTIONS.find(o => o.value === sort)!;
  const selectedCategory = CATEGORY_OPTIONS.find(o => o.value === category)!;

  return (
    <>
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <form onSubmit={onSearchSubmit} className="flex-1 relative">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca ambienti..."
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </form>

        {/* Category Filter */}
        <div className="relative">
          <button
            onClick={() => {
              setShowCategoryDropdown(!showCategoryDropdown);
              setShowSortDropdown(false);
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors min-w-[180px]"
          >
            <Filter size={16} />
            <span className="flex-1 text-left">{selectedCategory.label}</span>
            <ChevronDown size={16} />
          </button>
          {showCategoryDropdown && (
            <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-20">
              {CATEGORY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setCategory(option.value);
                    setShowCategoryDropdown(false);
                  }}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${
                    category === option.value
                      ? 'text-primary-600 dark:text-primary-400 font-medium'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sort */}
        <div className="relative">
          <button
            onClick={() => {
              setShowSortDropdown(!showSortDropdown);
              setShowCategoryDropdown(false);
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors min-w-[160px]"
          >
            {selectedSort.icon}
            <span className="flex-1 text-left">{selectedSort.label}</span>
            <ChevronDown size={16} />
          </button>
          {showSortDropdown && (
            <div className="absolute top-full right-0 mt-1 w-full bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-20">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setSort(option.value);
                    setShowSortDropdown(false);
                  }}
                  className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 ${
                    sort === option.value
                      ? 'text-primary-600 dark:text-primary-400 font-medium'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {option.icon}
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Refresh */}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Close dropdowns on outside click */}
      {(showCategoryDropdown || showSortDropdown) && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => {
            setShowCategoryDropdown(false);
            setShowSortDropdown(false);
          }}
        />
      )}

      {/* Results count */}
      {!loading && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {pagination.total} {pagination.total === 1 ? 'ambiente trovato' : 'ambienti trovati'}
        </p>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-pulse"
            >
              <div className="h-10 bg-slate-100 dark:bg-slate-700" />
              <div className="p-4 space-y-3">
                <div className="h-5 bg-slate-100 dark:bg-slate-700 rounded w-3/4" />
                <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-full" />
                <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-1/2" />
                <div className="flex gap-2 mt-4">
                  <div className="h-10 bg-slate-100 dark:bg-slate-700 rounded flex-1" />
                  <div className="h-10 bg-slate-100 dark:bg-slate-700 rounded flex-1" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : environments.length === 0 ? (
        <div className="text-center py-12">
          <Users size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
            Nessun ambiente trovato
          </h3>
          <p className="text-slate-600 dark:text-slate-400 mb-4">
            {searchQuery || category !== 'all'
              ? 'Prova a modificare i filtri di ricerca'
              : 'Sii il primo a condividere un ambiente!'}
          </p>
          {!searchQuery && category === 'all' && (
            <button
              onClick={onPublishClick}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              <Share2 size={16} />
              Condividi un ambiente
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {environments.map((env) => (
            <SharedEnvironmentCard
              key={env.id}
              environment={env}
              onLike={onLike}
              onImport={onImport}
              onReport={onReport}
              onSuggest={onSuggest}
              isLiking={likingIds.has(env.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => onPaginate(pagination.page - 1)}
            disabled={pagination.page <= 1 || loading}
            className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Precedente
          </button>
          <span className="px-4 py-2 text-slate-600 dark:text-slate-400">
            Pagina {pagination.page} di {pagination.pages}
          </span>
          <button
            onClick={() => onPaginate(pagination.page + 1)}
            disabled={pagination.page >= pagination.pages || loading}
            className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Successivo
          </button>
        </div>
      )}
    </>
  );
}
