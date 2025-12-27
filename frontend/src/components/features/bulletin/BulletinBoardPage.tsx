import { useState, useEffect, useCallback } from 'react';
import {
  Search, Share2, Filter, ChevronDown, RefreshCw, Users, TrendingUp, Clock,
} from 'lucide-react';
import { SharedEnvironmentCard } from './SharedEnvironmentCard';
import { PublishEnvironmentModal } from './PublishEnvironmentModal';
import { ImportEnvironmentModal } from './ImportEnvironmentModal';
import { ReportModal } from './ReportModal';
import { Toast } from '../../ui/Toast';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import type { SharedEnvironment, EnvironmentCategory, SharedEnvironmentListResponse } from '../../../types';

type SortOption = 'newest' | 'popular' | 'mostDownloaded';

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

export function BulletinBoardPage() {
  // State
  const [environments, setEnvironments] = useState<SharedEnvironment[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [likingIds, setLikingIds] = useState<Set<string>>(new Set());

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState<EnvironmentCategory | 'all'>('all');
  const [sort, setSort] = useState<SortOption>('newest');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  // Modals
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [importingEnv, setImportingEnv] = useState<SharedEnvironment | null>(null);
  const [reportingEnvId, setReportingEnvId] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
  };

  // Fetch environments
  const fetchEnvironments = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const response: SharedEnvironmentListResponse = await sharedEnvironmentService.list({
        page,
        limit: 12,
        category: category === 'all' ? undefined : category,
        sort,
        search: searchQuery || undefined,
      });
      setEnvironments(response.data);
      setPagination({
        page: response.pagination.page,
        pages: response.pagination.pages,
        total: response.pagination.total,
      });
    } catch (error: any) {
      showToast(error.message || 'Errore nel caricamento degli ambienti', 'error');
    } finally {
      setLoading(false);
    }
  }, [category, sort, searchQuery]);

  // Initial fetch and refetch on filter changes
  useEffect(() => {
    fetchEnvironments(1);
  }, [fetchEnvironments]);

  // Handle like
  const handleLike = async (id: string) => {
    if (likingIds.has(id)) return;

    setLikingIds(prev => new Set(prev).add(id));
    try {
      const result = await sharedEnvironmentService.toggleLike(id);
      setEnvironments(prev =>
        prev.map(env =>
          env.id === id
            ? { ...env, userLiked: result.liked, likeCount: result.likeCount }
            : env
        )
      );
    } catch (error: any) {
      showToast(error.message || 'Errore nel mettere mi piace', 'error');
    } finally {
      setLikingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // Handle import click
  const handleImportClick = (env: SharedEnvironment) => {
    setImportingEnv(env);
  };

  // Handle import complete
  const handleImportComplete = () => {
    setImportingEnv(null);
    showToast('Ambiente importato con successo!', 'success');
  };

  // Handle report
  const handleReport = (id: string) => {
    setReportingEnvId(id);
  };

  // Handle report complete
  const handleReportComplete = () => {
    setReportingEnvId(null);
    showToast('Segnalazione inviata. Grazie per il tuo contributo!', 'success');
  };

  // Handle publish complete
  const handlePublishComplete = (newEnv: SharedEnvironment) => {
    setShowPublishModal(false);
    setEnvironments(prev => [newEnv, ...prev]);
    showToast('Ambiente pubblicato con successo!', 'success');
  };

  // Handle search submit
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchEnvironments(1);
  };

  // Selected sort option
  const selectedSort = SORT_OPTIONS.find(o => o.value === sort)!;
  const selectedCategory = CATEGORY_OPTIONS.find(o => o.value === category)!;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="text-primary-600" size={28} />
            Bacheca Ambienti
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Esplora e condividi ambienti con la community
          </p>
        </div>
        <button
          onClick={() => setShowPublishModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium shadow-sm"
        >
          <Share2 size={18} />
          Condividi un ambiente
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="flex-1 relative">
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
          onClick={() => fetchEnvironments(pagination.page)}
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
              onClick={() => setShowPublishModal(true)}
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
              onLike={handleLike}
              onImport={handleImportClick}
              onReport={handleReport}
              isLiking={likingIds.has(env.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => fetchEnvironments(pagination.page - 1)}
            disabled={pagination.page <= 1 || loading}
            className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Precedente
          </button>
          <span className="px-4 py-2 text-slate-600 dark:text-slate-400">
            Pagina {pagination.page} di {pagination.pages}
          </span>
          <button
            onClick={() => fetchEnvironments(pagination.page + 1)}
            disabled={pagination.page >= pagination.pages || loading}
            className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Successivo
          </button>
        </div>
      )}

      {/* Modals */}
      {showPublishModal && (
        <PublishEnvironmentModal
          onClose={() => setShowPublishModal(false)}
          onPublished={handlePublishComplete}
        />
      )}

      {importingEnv && (
        <ImportEnvironmentModal
          sharedEnvironment={importingEnv}
          onClose={() => setImportingEnv(null)}
          onImported={handleImportComplete}
        />
      )}

      {reportingEnvId && (
        <ReportModal
          environmentId={reportingEnvId}
          onClose={() => setReportingEnvId(null)}
          onReported={handleReportComplete}
        />
      )}

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          isVisible={!!toast}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
