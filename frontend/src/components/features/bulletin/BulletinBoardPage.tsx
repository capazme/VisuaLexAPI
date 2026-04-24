import { useState, useEffect, useCallback } from 'react';
import { Search, Share2, Users, Package, Lightbulb } from 'lucide-react';
import { PublishEnvironmentModal } from './PublishEnvironmentModal';
import { ImportEnvironmentModal } from './ImportEnvironmentModal';
import { ReportModal } from './ReportModal';
import { SuggestContentModal } from './SuggestContentModal';
import { EditSharedEnvironmentModal } from './EditSharedEnvironmentModal';
import { ForumExploreView, type SortOption } from './ForumExploreView';
import { ForumMyEnvironmentsView } from './ForumMyEnvironmentsView';
import { ForumSuggestionsView } from './ForumSuggestionsView';
import { Toast } from '../../ui/Toast';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import type { SharedEnvironment, EnvironmentCategory, SharedEnvironmentListResponse, EnvironmentSuggestion } from '../../../types';

type TabType = 'explore' | 'my' | 'suggestions';

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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Errore nel caricamento degli ambienti';
      showToast(message, 'error');
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Errore nel mettere mi piace';
      showToast(message, 'error');
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="text-primary-600" size={28} />
            Forum Ambienti
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

      {/* Tab views */}
      {activeTab === 'explore' && (
        <ForumExploreView
          environments={environments}
          pagination={pagination}
          loading={loading}
          likingIds={likingIds}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          category={category}
          setCategory={setCategory}
          sort={sort}
          setSort={setSort}
          showCategoryDropdown={showCategoryDropdown}
          setShowCategoryDropdown={setShowCategoryDropdown}
          showSortDropdown={showSortDropdown}
          setShowSortDropdown={setShowSortDropdown}
          onSearchSubmit={handleSearchSubmit}
          onRefresh={() => fetchEnvironments(pagination.page)}
          onPaginate={fetchEnvironments}
          onLike={handleLike}
          onImport={handleImportClick}
          onReport={handleReport}
          onSuggest={handleSuggest}
          onPublishClick={() => setShowPublishModal(true)}
        />
      )}

      {activeTab === 'my' && (
        <ForumMyEnvironmentsView
          environments={myEnvironments}
          loading={myEnvLoading}
          likingIds={likingIds}
          onLike={handleLike}
          onImport={handleImportClick}
          onReport={handleReport}
          onEdit={handleEdit}
          onDelete={handleDeleteClick}
          onWithdraw={handleWithdraw}
          onRepublish={handleRepublish}
          onPublishClick={() => setShowPublishModal(true)}
        />
      )}

      {activeTab === 'suggestions' && (
        <ForumSuggestionsView
          receivedSuggestions={receivedSuggestions}
          sentSuggestions={sentSuggestions}
          loading={suggestionsLoading}
          suggestionTab={suggestionTab}
          setSuggestionTab={setSuggestionTab}
          pendingCount={pendingCount}
          onApprove={handleApproveSuggestion}
          onReject={handleRejectSuggestion}
        />
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

      {/* Delete Confirmation — shared ConfirmDialog pattern. Deletes the
          shared environment from the forum along with all its versions,
          likes and comments. */}
      <ConfirmDialog
        open={deletingEnv !== null}
        variant="danger"
        title={deletingEnv ? `Eliminare "${deletingEnv.title}"?` : 'Eliminare ambiente?'}
        message="L'ambiente e tutte le sue versioni, mi piace e segnalazioni verranno rimossi definitivamente dal forum. Questa azione non è reversibile."
        confirmLabel="Elimina definitivamente"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletingEnv(null)}
      />

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
