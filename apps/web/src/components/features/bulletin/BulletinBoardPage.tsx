import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Upload, Package, Lightbulb } from 'lucide-react';
import { AddToMyDossiersDialog } from './AddToMyDossiersDialog';
import { PublishDossierPicker } from './PublishDossierPicker';
import { ReportModal } from './ReportModal';
import { SuggestContentModal } from './SuggestContentModal';
import { EditSharedEnvironmentModal } from './EditSharedEnvironmentModal';
import { SuggestionReviewDialog, type TakeResult } from './SuggestionReviewDialog';
import { EditSuggestionDialog } from './EditSuggestionDialog';
import { AliasConflictDialog } from './AliasConflictDialog';
import { ForumExploreView, type SortOption } from './ForumExploreView';
import { ForumMyEnvironmentsView } from './ForumMyEnvironmentsView';
import { ForumSuggestionsView } from './ForumSuggestionsView';
import { ArchivedEnvironmentsSection } from './ArchivedEnvironmentsSection';
import { SharedLinkImport } from './SharedLinkImport';
import { Toast } from '../../ui/Toast';
import { WireConfirm } from '../../ui/wireConfirm/WireConfirm';
import { useTour } from '../../../hooks/useTour';
import { useAppStore } from '../../../store/useAppStore';
import { studyImportSentence } from '../../../utils/studyImportReport';
import { sharedEnvironmentService } from '../../../services/sharedEnvironmentService';
import { customAliasService } from '../../../services/customAliasService';
import { notificationService } from '../../../services/notificationService';
import { publishMerltEvent, MERLT_EVENT_TYPES } from '../../../features/merlt/merltEventBus';
import type { SharedEnvironment, EnvironmentCategory, SharedEnvironmentListResponse, EnvironmentSuggestion, StudyImportReport } from '../../../types';
import { PageFrame } from '../../layout/PageFrame';

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
  // The deleted copy whose card waits for «Eliminata ✓» to go (K1b).
  const deletedEnvIds = useRef<string[]>([]);
  // The copy the confirmation names, kept while it leaves (its title does not empty under the rewind).
  const [shownEnv, setShownEnv] = useState<SharedEnvironment | null>(null);
  const [reviewingSuggestion, setReviewingSuggestion] = useState<EnvironmentSuggestion | null>(null);
  const [editingSuggestion, setEditingSuggestion] = useState<EnvironmentSuggestion | null>(null);
  const [aliasConflict, setAliasConflict] = useState<{ itemId: string; suggestedTrigger: string; existingAliasId?: string } | null>(null);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info'; action?: { label: string; onClick: () => void } } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
  };

  const navigate = useNavigate();
  const refreshDossiers = useAppStore((s) => s.refreshDossiers);

  /** What became study dossiers (a download, a pack): said, the list read again, the one new dossier one tap away. */
  const handleStudyDossiersAdded = (report: StudyImportReport) => {
    void refreshDossiers();
    const [only] = report.dossiers.length === 1 ? report.dossiers : [];
    setToast({
      message: studyImportSentence(report),
      type: report.dossiers.length ? 'success' : 'info',
      ...(only ? { action: { label: 'Apri', onClick: () => navigate(`/dossier?dossier=${only.id}`) } } : {}),
    });
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
      const message = error instanceof Error ? error.message : 'Errore nel caricamento dei dossier pubblici';
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
      showToast('Dossier ritirato', 'success');
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
      showToast('Dossier di nuovo nel Forum', 'success');
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
    showToast('Dossier pubblicato aggiornato', 'success');
  };

  // Delete handler
  const handleDeleteClick = (env: SharedEnvironment) => {
    setDeletingEnv(env);
    setShownEnv(env);
  };

  /** The deletion; the card's menu button says «Eliminata» with its tick, and the card goes once it has said it. */
  const handleDeleteConfirm = async (): Promise<string | null> => {
    const env = deletingEnv;
    if (!env) return null;
    setDeletingEnv(null);
    try {
      await sharedEnvironmentService.delete(env.id);
      deletedEnvIds.current.push(env.id);
      showToast('Copia pubblicata eliminata', 'success');
      return 'Eliminata';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Errore';
      showToast(message, 'error');
      return null;
    }
  };

  // The deleted copy's card goes once its tick has said it; the focus it held goes to the next card's menu button.
  const dropDeletedEnv = () => {
    // Oldest first: two deleted in a row each go when theirs has been said.
    const id = deletedEnvIds.current.shift();
    if (!id) return;
    const lost = document.activeElement === document.body || document.activeElement === null
      || document.activeElement?.closest('[data-shared-env]')?.getAttribute('data-shared-env') === id;
    const triggers = [...document.querySelectorAll<HTMLElement>('[data-shared-env] [aria-label^="Azioni su"]')];
    const at = triggers.findIndex((t) => t.closest('[data-shared-env]')?.getAttribute('data-shared-env') === id);
    setMyEnvironments(prev => prev.filter(e => e.id !== id));
    if (lost) (triggers[at + 1] ?? triggers[at - 1])?.focus({ preventScroll: true });
  };

  // Suggestion item handlers
  const handleTakeItem = useCallback(async (itemId: string): Promise<TakeResult> => {
    if (!reviewingSuggestion) return { kind: 'ok' };
    try {
      await sharedEnvironmentService.takeSuggestionItem(reviewingSuggestion.id, itemId);
      await fetchSuggestions();
      // MERLT-1.10: forum_suggestion_accepted — the environment only; the suggester is a
      // third party who never consented to MERL-T (docs/merlt/decisions/forum-authoring.md).
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.forumSuggestionAccepted,
        metadata: {
          suggestion_id: reviewingSuggestion.id,
          shared_env_id: reviewingSuggestion.sharedEnvironmentId,
        },
      });
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
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.forumSuggestionDeclined,
        metadata: {
          suggestion_id: reviewingSuggestion.id,
          shared_env_id: reviewingSuggestion.sharedEnvironmentId,
          reason: reviewNote ?? null,
        },
      });
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
      // MERLT-1.10: emit forum_like only on transition to liked=true
      // (unliking is not an authority signal).
      if (result.liked) {
        publishMerltEvent({
          interaction_type: MERLT_EVENT_TYPES.forumLike,
          metadata: {
            shared_env_id: id,
          },
        });
      }
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

  // «Aggiungi ai miei dossier» done: the download is counted for someone else's item.
  const handleImportComplete = (env: SharedEnvironment, report: StudyImportReport) => {
    setImportingEnv(null);
    if (!env.isOwner) {
      const bump = (e: SharedEnvironment) => (e.id === env.id ? { ...e, downloadCount: e.downloadCount + 1 } : e);
      setEnvironments((prev) => prev.map(bump));
    }
    handleStudyDossiersAdded(report);
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

  // A dossier published from the Forum's own button: the lists are read again.
  const handlePublishComplete = (message: string) => {
    setShowPublishModal(false);
    showToast(message, 'success');
    void fetchEnvironments(1);
    if (activeTab === 'my') void fetchMyEnvironments();
  };

  // Handle search submit
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchEnvironments(1);
  };

  return (
    <PageFrame
      title="Dossier pubblici"
      line="I dossier di studio pubblicati dalla comunità"
      section="forum"
      action={
        <button
          id="tour-forum-publish"
          onClick={() => setShowPublishModal(true)}
          className="flex min-h-[44px] items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 md:min-h-0"
        >
          <Upload size={18} />
          Pubblica un dossier
        </button>
      }
    >

      {/* Tab Navigation */}
      <div id="tour-forum-tabs" className="flex max-w-full gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('explore')}
          className={`flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:px-4 md:min-h-0 ${
            activeTab === 'explore'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Search size={16} className="hidden sm:block" aria-hidden />
          Esplora
        </button>
        <button
          onClick={() => setActiveTab('my')}
          className={`flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:px-4 md:min-h-0 ${
            activeTab === 'my'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Package size={16} className="hidden sm:block" aria-hidden />
          I miei pubblicati
        </button>
        <button
          onClick={() => setActiveTab('suggestions')}
          className={`flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:px-4 md:min-h-0 relative ${
            activeTab === 'suggestions'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Lightbulb size={16} className="hidden sm:block" aria-hidden />
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
          onPacksAdded={handleStudyDossiersAdded}
          onPacksError={(message) => showToast(message, 'error')}
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
      {activeTab === 'my' && (
        <ArchivedEnvironmentsSection onRecovered={handleStudyDossiersAdded} onMessage={showToast} />
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
        <PublishDossierPicker
          onClose={() => setShowPublishModal(false)}
          onPublished={handlePublishComplete}
        />
      )}

      <SharedLinkImport onRecovered={handleStudyDossiersAdded} />

      {importingEnv && (
        <AddToMyDossiersDialog
          sharedEnvironment={importingEnv}
          onClose={() => setImportingEnv(null)}
          onAdded={(report) => handleImportComplete(importingEnv, report)}
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
                await sharedEnvironmentService.takeSuggestionItem(reviewingSuggestion.id, aliasConflict.itemId, choice.newTrigger);
                // MERLT-1.10: forum_suggestion_accepted — same shape as handleTakeItem.
                publishMerltEvent({
                  interaction_type: MERLT_EVENT_TYPES.forumSuggestionAccepted,
                  metadata: {
                    suggestion_id: reviewingSuggestion.id,
                    shared_env_id: reviewingSuggestion.sharedEnvironmentId,
                  },
                });
              }
              await fetchSuggestions();
              setToast({ type: 'success', message: 'Item preso.' });
            } catch (err: unknown) {
              const maybeAxios = err as { response?: { status?: number; data?: { error?: string; suggestedTrigger?: string; existingAliasId?: string } } };
              if (choice.action === 'rename' && maybeAxios.response?.status === 409 && maybeAxios.response.data?.error === 'alias_trigger_conflict') {
                const body = maybeAxios.response.data as { suggestedTrigger: string; existingAliasId?: string };
                setAliasConflict({ itemId: aliasConflict.itemId, suggestedTrigger: body.suggestedTrigger, existingAliasId: body.existingAliasId });
                return;
              }
              const msg = err instanceof Error ? err.message : 'Errore';
              setToast({ type: 'error', message: msg });
              setAliasConflict(null);
              return;
            }
            setAliasConflict(null);
          }}
          onClose={() => setAliasConflict(null)}
        />
      )}

      {/* Deletes the published copy with its versions, likes and reports, which are others' too: drawn from the card's
          menu button (K1b). */}
      <WireConfirm
        open={deletingEnv !== null}
        variant="danger"
        title={shownEnv ? `Eliminare «${shownEnv.title}» dai dossier pubblici?` : 'Eliminare dai dossier pubblici?'}
        message="La copia pubblicata, le sue versioni, i «Mi piace» e le segnalazioni vengono eliminati. Il tuo dossier resta com'è; chi l'ha già aggiunto ai suoi dossier ne conserva la copia."
        confirmLabel="Elimina definitivamente"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletingEnv(null)}
        onOutcomeDone={dropDeletedEnv}
      />

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          isVisible={!!toast}
          onClose={() => setToast(null)}
          action={toast.action}
        />
      )}
    </PageFrame>
  );
}
