import { useState, useEffect, useCallback } from 'react';
import {
  Search, Share2, Filter, ChevronDown, RefreshCw, Users, TrendingUp, Clock,
  Package, Lightbulb, Inbox, Send, Check, X as XIcon, AlertCircle,
} from 'lucide-react';
import { SharedEnvironmentCard } from './SharedEnvironmentCard';
import { PublishEnvironmentModal } from './PublishEnvironmentModal';
import { ImportEnvironmentModal } from './ImportEnvironmentModal';
import { ReportModal } from './ReportModal';
import { SuggestContentModal } from './SuggestContentModal';
import { EditSharedEnvironmentModal } from './EditSharedEnvironmentModal';
import { Toast } from '../../ui/Toast';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import type { SharedEnvironment, EnvironmentCategory, SharedEnvironmentListResponse, EnvironmentSuggestion } from '../../../types';

type SortOption = 'newest' | 'popular' | 'mostDownloaded';
type TabType = 'explore' | 'my' | 'suggestions';

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
  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('explore');

  // State - Explore
  const [environments, setEnvironments] = useState<SharedEnvironment[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [likingIds, setLikingIds] = useState<Set<string>>(new Set());

  // State - My Environments
  const [myEnvironments, setMyEnvironments] = useState<SharedEnvironment[]>([]);
  const [myEnvLoading, setMyEnvLoading] = useState(false);

  // State - Suggestions
  const [receivedSuggestions, setReceivedSuggestions] = useState<EnvironmentSuggestion[]>([]);
  const [sentSuggestions, setSentSuggestions] = useState<EnvironmentSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionTab, setSuggestionTab] = useState<'received' | 'sent'>('received');
  const [pendingCount, setPendingCount] = useState(0);

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
  const [suggestingTo, setSuggestingTo] = useState<SharedEnvironment | null>(null);
  const [editingEnv, setEditingEnv] = useState<SharedEnvironment | null>(null);
  const [deletingEnv, setDeletingEnv] = useState<SharedEnvironment | null>(null);

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
    if (activeTab === 'explore') {
      fetchEnvironments(1);
    }
  }, [fetchEnvironments, activeTab]);

  // Fetch my environments
  const fetchMyEnvironments = useCallback(async () => {
    setMyEnvLoading(true);
    try {
      const data = await sharedEnvironmentService.getMyShared();
      setMyEnvironments(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Errore nel caricamento';
      showToast(message, 'error');
    } finally {
      setMyEnvLoading(false);
    }
  }, []);

  // Fetch suggestions
  const fetchSuggestions = useCallback(async () => {
    setSuggestionsLoading(true);
    try {
      const [received, sent, count] = await Promise.all([
        sharedEnvironmentService.getReceivedSuggestions(),
        sharedEnvironmentService.getSentSuggestions(),
        sharedEnvironmentService.getPendingSuggestionsCount(),
      ]);
      setReceivedSuggestions(received);
      setSentSuggestions(sent);
      setPendingCount(count);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Errore nel caricamento';
      showToast(message, 'error');
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  // Fetch data when tab changes
  useEffect(() => {
    if (activeTab === 'my') {
      fetchMyEnvironments();
    } else if (activeTab === 'suggestions') {
      fetchSuggestions();
    }
  }, [activeTab, fetchMyEnvironments, fetchSuggestions]);

  // Owner actions
  const handleWithdraw = async (env: SharedEnvironment) => {
    try {
      await sharedEnvironmentService.withdraw(env.id);
      setMyEnvironments(prev =>
        prev.map(e => e.id === env.id ? { ...e, isActive: false } : e)
      );
      showToast('Ambiente ritirato', 'success');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Errore';
      showToast(message, 'error');
    }
  };

  const handleRepublish = async (env: SharedEnvironment) => {
    try {
      await sharedEnvironmentService.republish(env.id);
      setMyEnvironments(prev =>
        prev.map(e => e.id === env.id ? { ...e, isActive: true } : e)
      );
      showToast('Ambiente ripubblicato', 'success');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Errore';
      showToast(message, 'error');
    }
  };

  // Edit handler
  const handleEdit = (env: SharedEnvironment) => {
    setEditingEnv(env);
  };

  const handleEditComplete = (updated: SharedEnvironment) => {
    setEditingEnv(null);
    setMyEnvironments(prev =>
      prev.map(e => e.id === updated.id ? updated : e)
    );
    showToast(`Ambiente aggiornato a v${updated.currentVersion}`, 'success');
  };

  // Delete handler
  const handleDeleteClick = (env: SharedEnvironment) => {
    setDeletingEnv(env);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingEnv) return;

    try {
      await sharedEnvironmentService.delete(deletingEnv.id);
      setMyEnvironments(prev => prev.filter(e => e.id !== deletingEnv.id));
      setDeletingEnv(null);
      showToast('Ambiente eliminato definitivamente', 'success');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Errore';
      showToast(message, 'error');
    }
  };

  // Suggestion actions
  const handleApproveSuggestion = async (suggestion: EnvironmentSuggestion) => {
    try {
      await sharedEnvironmentService.approveSuggestion(suggestion.id, {
        versionMode: 'replace',
        mergeMode: 'merge',
      });
      setReceivedSuggestions(prev =>
        prev.map(s => s.id === suggestion.id ? { ...s, status: 'approved' } : s)
      );
      setPendingCount(prev => Math.max(0, prev - 1));
      showToast('Suggerimento approvato! Nuova versione creata.', 'success');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Errore';
      showToast(message, 'error');
    }
  };

  const handleRejectSuggestion = async (suggestion: EnvironmentSuggestion) => {
    try {
      await sharedEnvironmentService.rejectSuggestion(suggestion.id);
      setReceivedSuggestions(prev =>
        prev.map(s => s.id === suggestion.id ? { ...s, status: 'rejected' } : s)
      );
      setPendingCount(prev => Math.max(0, prev - 1));
      showToast('Suggerimento rifiutato', 'info');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Errore';
      showToast(message, 'error');
    }
  };

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

  // Handle suggest
  const handleSuggest = (env: SharedEnvironment) => {
    setSuggestingTo(env);
  };

  // Handle suggest complete
  const handleSuggestComplete = () => {
    setSuggestingTo(null);
    showToast('Suggerimento inviato con successo!', 'success');
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

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('explore')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'explore'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Search size={16} />
          Esplora
        </button>
        <button
          onClick={() => setActiveTab('my')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'my'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Package size={16} />
          I Miei
        </button>
        <button
          onClick={() => setActiveTab('suggestions')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors relative ${
            activeTab === 'suggestions'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Lightbulb size={16} />
          Suggerimenti
          {pendingCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary-600 text-white text-xs rounded-full flex items-center justify-center">
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* EXPLORE TAB */}
      {activeTab === 'explore' && (
        <>
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
              onSuggest={handleSuggest}
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
        </>
      )}

      {/* MY TAB */}
      {activeTab === 'my' && (
        <>
          {myEnvLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-pulse"
                >
                  <div className="h-10 bg-slate-100 dark:bg-slate-700" />
                  <div className="p-4 space-y-3">
                    <div className="h-5 bg-slate-100 dark:bg-slate-700 rounded w-3/4" />
                    <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-full" />
                    <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : myEnvironments.length === 0 ? (
            <div className="text-center py-12">
              <Package size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                Nessun ambiente pubblicato
              </h3>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                Non hai ancora condiviso nessun ambiente con la community.
              </p>
              <button
                onClick={() => setShowPublishModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                <Share2 size={16} />
                Condividi un ambiente
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {myEnvironments.length} {myEnvironments.length === 1 ? 'ambiente pubblicato' : 'ambienti pubblicati'}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {myEnvironments.map((env) => (
                  <SharedEnvironmentCard
                    key={env.id}
                    environment={env}
                    onLike={handleLike}
                    onImport={handleImportClick}
                    onReport={handleReport}
                    onEdit={handleEdit}
                    onDelete={handleDeleteClick}
                    onWithdraw={handleWithdraw}
                    onRepublish={handleRepublish}
                    isLiking={likingIds.has(env.id)}
                    showOwnerActions={true}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* SUGGESTIONS TAB */}
      {activeTab === 'suggestions' && (
        <>
          {/* Sub-tabs for received/sent */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setSuggestionTab('received')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                suggestionTab === 'received'
                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Inbox size={16} />
              Ricevuti
              {pendingCount > 0 && (
                <span className="ml-1 px-2 py-0.5 text-xs bg-primary-600 text-white rounded-full">
                  {pendingCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setSuggestionTab('sent')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                suggestionTab === 'sent'
                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Send size={16} />
              Inviati
            </button>
          </div>

          {suggestionsLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 animate-pulse"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-slate-100 dark:bg-slate-700 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-1/3" />
                      <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded w-2/3" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : suggestionTab === 'received' ? (
            receivedSuggestions.length === 0 ? (
              <div className="text-center py-12">
                <Inbox size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                  Nessun suggerimento ricevuto
                </h3>
                <p className="text-slate-600 dark:text-slate-400">
                  Quando qualcuno suggerirà contenuti per i tuoi ambienti, li vedrai qui.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {receivedSuggestions.map((suggestion) => (
                  <div
                    key={suggestion.id}
                    className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                            suggestion.status === 'pending'
                              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                              : suggestion.status === 'approved'
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                          }`}>
                            {suggestion.status === 'pending' ? 'In attesa' : suggestion.status === 'approved' ? 'Approvato' : 'Rifiutato'}
                          </span>
                          <span className="text-sm text-slate-500 dark:text-slate-400">
                            da @{suggestion.suggester.username}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">
                          Suggerimento per "{suggestion.sharedEnvironment?.title}"
                        </p>
                        {suggestion.message && (
                          <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                            "{suggestion.message}"
                          </p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                          <span>{suggestion.content.dossiers.length} dossier</span>
                          <span>{suggestion.content.quickNorms.length} norme veloci</span>
                          <span>{suggestion.content.customAliases.length} alias</span>
                        </div>
                      </div>
                      {suggestion.status === 'pending' && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleApproveSuggestion(suggestion)}
                            className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                            title="Approva"
                          >
                            <Check size={18} />
                          </button>
                          <button
                            onClick={() => handleRejectSuggestion(suggestion)}
                            className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                            title="Rifiuta"
                          >
                            <XIcon size={18} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            sentSuggestions.length === 0 ? (
              <div className="text-center py-12">
                <Send size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                  Nessun suggerimento inviato
                </h3>
                <p className="text-slate-600 dark:text-slate-400">
                  Esplora gli ambienti della community e suggerisci contenuti!
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {sentSuggestions.map((suggestion) => (
                  <div
                    key={suggestion.id}
                    className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                            suggestion.status === 'pending'
                              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                              : suggestion.status === 'approved'
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                          }`}>
                            {suggestion.status === 'pending' ? 'In attesa' : suggestion.status === 'approved' ? 'Approvato' : 'Rifiutato'}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">
                          A "{suggestion.sharedEnvironment?.title}" di @{suggestion.sharedEnvironment?.user.username}
                        </p>
                        {suggestion.message && (
                          <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                            "{suggestion.message}"
                          </p>
                        )}
                        {suggestion.reviewNote && (
                          <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                            Risposta: "{suggestion.reviewNote}"
                          </p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-2">
                          <span>{suggestion.content.dossiers.length} dossier</span>
                          <span>{suggestion.content.quickNorms.length} norme veloci</span>
                          <span>{suggestion.content.customAliases.length} alias</span>
                        </div>
                      </div>
                      {suggestion.status === 'pending' && (
                        <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <AlertCircle size={14} />
                          In attesa
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </>
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

      {suggestingTo && (
        <SuggestContentModal
          environment={suggestingTo}
          onClose={() => setSuggestingTo(null)}
          onSuggested={handleSuggestComplete}
        />
      )}

      {editingEnv && (
        <EditSharedEnvironmentModal
          environment={editingEnv}
          onClose={() => setEditingEnv(null)}
          onUpdated={handleEditComplete}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deletingEnv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
              Elimina ambiente
            </h3>
            <p className="text-slate-600 dark:text-slate-400 mb-4">
              Sei sicuro di voler eliminare definitivamente "{deletingEnv.title}"?
              Questa azione non può essere annullata.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setDeletingEnv(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                Annulla
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Elimina definitivamente
              </button>
            </div>
          </div>
        </div>
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
