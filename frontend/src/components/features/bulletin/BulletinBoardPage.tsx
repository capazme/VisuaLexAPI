import { useState, useEffect, useCallback } from 'react';
import { Search, Share2, Users, Package, Lightbulb } from 'lucide-react';
import { PublishEnvironmentModal } from './PublishEnvironmentModal';
import { ImportEnvironmentModal } from './ImportEnvironmentModal';
import { ReportModal } from './ReportModal';
import { SuggestContentModal } from './SuggestContentModal';
import { EditSharedEnvironmentModal } from './EditSharedEnvironmentModal';
import { SuggestionReviewDialog, type TakeResult } from './SuggestionReviewDialog';
import { EditSuggestionDialog } from './EditSuggestionDialog';
import { AliasConflictDialog } from './AliasConflictDialog';
import { ForumExploreView, type SortOption } from './ForumExploreView';
import { ForumMyEnvironmentsView } from './ForumMyEnvironmentsView';
import { ForumSuggestionsView } from './ForumSuggestionsView';
import { Toast } from '../../ui/Toast';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { useTour } from '../../../hooks/useTour';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { customAliasService } from '../../../services/customAliasService';
import { notificationService } from '../../../services/notificationService';
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
  const [reviewingSuggestion, setReviewingSuggestion] = useState<EnvironmentSuggestion | null>(null);
  const [editingSuggestion, setEditingSuggestion] = useState<EnvironmentSuggestion | null>(null);
  const [aliasConflict, setAliasConflict] = useState<{ itemId: string; suggestedTrigger: string; existingAliasId?: string } | null>(null);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
  };

  // Tour
  const { tryStartTour } = useTour();
  useEffect(() => {
    tryStartTour('forum');
  }, [tryStartTour]);

  // Mark forum-notifications as read once on mount — clears the sidebar
  // badge for likes. Pending suggestions clear naturally on review.
  useEffect(() => {
    void notificationService.markRead().catch(() => {});
  }, []);

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

  // Suggestion item handlers
  const handleTakeItem = useCallback(async (itemId: string): Promise<TakeResult> => {
    if (!reviewingSuggestion) return { kind: 'ok' };
    try {
      await sharedEnvironmentService.takeSuggestionItem(reviewingSuggestion.id, itemId);
      await fetchSuggestions();
      setToast({ type: 'success', message: 'Item preso.' });
      return { kind: 'ok' };
    } catch (err: unknown) {
      const maybeAxios = err as { response?: { status?: number; data?: { error?: string; suggestedTrigger?: string; existingAliasId?: string } } };
      if (maybeAxios.response?.status === 409 && maybeAxios.response.data?.error === 'alias_trigger_conflict') {
        const body = maybeAxios.response.data as { suggestedTrigger: string; existingAliasId?: string };
        setAliasConflict({ itemId, suggestedTrigger: body.suggestedTrigger, existingAliasId: body.existingAliasId });
        return { kind: 'alias_conflict', itemId, suggestedTrigger: body.suggestedTrigger, existingAliasId: body.existingAliasId };
      }
      const msg = err instanceof Error ? err.message : 'Errore';
      setToast({ type: 'error', message: msg });
      return { kind: 'ok' };
    }
  }, [reviewingSuggestion, fetchSuggestions]);

  const handleDeclineItem = useCallback(async (itemId: string, reviewNote?: string) => {
    if (!reviewingSuggestion) return;
    try {
      await sharedEnvironmentService.declineSuggestionItem(reviewingSuggestion.id, itemId, reviewNote);
      await fetchSuggestions();
      setToast({ type: 'success', message: 'Item rifiutato.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore';
      setToast({ type: 'error', message: msg });
    }
  }, [reviewingSuggestion, fetchSuggestions]);

  const handleRevokeItem = useCallback(async (itemId: string) => {
    if (!editingSuggestion) return;
    try {
      await sharedEnvironmentService.revokeSuggestionItem(editingSuggestion.id, itemId);
      await fetchSuggestions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore';
      setToast({ type: 'error', message: msg });
    }
  }, [editingSuggestion, fetchSuggestions]);

  // Sync reviewingSuggestion with refreshed server data. reviewingSuggestion is intentionally
  // omitted from deps: including it creates an infinite loop (effect updates it → re-triggers).
  useEffect(() => {
    if (!reviewingSuggestion) return;
    const fresh = receivedSuggestions.find(s => s.id === reviewingSuggestion.id);
    if (fresh) setReviewingSuggestion(fresh);
  }, [receivedSuggestions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync editingSuggestion with refreshed server data — same rationale as above.
  useEffect(() => {
    if (!editingSuggestion) return;
    const fresh = sentSuggestions.find(s => s.id === editingSuggestion.id);
    if (fresh) setEditingSuggestion(fresh);
  }, [sentSuggestions]); // eslint-disable-line react-hooks/exhaustive-deps

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
          id="tour-forum-publish"
          onClick={() => setShowPublishModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium shadow-sm"
        >
          <Share2 size={18} />
          Condividi un ambiente
        </button>
      </div>

      {/* Tab Navigation */}
      <div id="tour-forum-tabs" className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg w-fit">
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
          onResetFilters={() => {
            setSearchQuery('');
            setCategory('all');
          }}
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
          onOpenReview={setReviewingSuggestion}
          onOpenEdit={setEditingSuggestion}
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

      {reviewingSuggestion && (
        <SuggestionReviewDialog
          suggestion={reviewingSuggestion}
          onTake={handleTakeItem}
          onDecline={handleDeclineItem}
          onClose={() => setReviewingSuggestion(null)}
        />
      )}

      {editingSuggestion && (
        <EditSuggestionDialog
          suggestion={editingSuggestion}
          onRevoke={handleRevokeItem}
          onItemsAdded={() => { void fetchSuggestions(); }}
          onClose={() => setEditingSuggestion(null)}
        />
      )}

      {aliasConflict && (
        <AliasConflictDialog
          suggestedTrigger={aliasConflict.suggestedTrigger}
          onChoose={async (choice) => {
            if (choice.action === 'skip') { setAliasConflict(null); return; }
            if (!reviewingSuggestion) { setAliasConflict(null); return; }
            try {
              if (choice.action === 'replace') {
                if (!aliasConflict.existingAliasId) {
                  throw new Error('Missing existingAliasId in alias conflict body');
                }
                await customAliasService.delete(aliasConflict.existingAliasId);
                await sharedEnvironmentService.takeSuggestionItem(reviewingSuggestion.id, aliasConflict.itemId);
              } else if (choice.action === 'rename') {
                // Rename is MVP-deferred — see Task 10 Step 8 rationale.
                // Replace + Skip cover the main flows; Rename requires a
                // backend query-param override (Task 12 nice-to-have).
                setToast({ type: 'info', message: 'Funzione Rinomina non ancora implementata — usa Sostituisci o Salta.' });
              }
              await fetchSuggestions();
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Errore';
              setToast({ type: 'error', message: msg });
            } finally {
              setAliasConflict(null);
            }
          }}
          onClose={() => setAliasConflict(null)}
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
