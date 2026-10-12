import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PanInfo } from 'framer-motion';
import { WorkspaceManager } from '../workspace/WorkspaceManager';
import { CommandPalette } from './CommandPalette';
import { QuickNormsManager } from './QuickNormsManager';
import { AliasManager } from '../settings/AliasManager';
const PDFViewer = lazy(() => import('../../ui/PDFViewer').then(m => ({ default: m.PDFViewer })));
import { WorkspaceNavigator } from '../workspace/WorkspaceNavigator';
import { NormaCard } from './NormaCard';
import { renderTabView } from '../workspace/renderTabView';
import { AnnexSwitchDialog } from '../../ui/AnnexSwitchDialog';
import type { SearchParams, ArticleData, Norma } from '../../../types';
import { SearchX, Search, X, Star, Plus, Sparkles, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { addToHistory } from '../../../services/historyService';
import { isAuthenticated } from '../../../services/authService';
import { useSearchParams } from 'react-router-dom';
import { appStore, useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../../lib/utils';
import { useAutoSwitch } from '../../../hooks/useAutoSwitch';
import { Z_INDEX } from '../../../constants/zIndex';
import { getErrorMessage } from '../../../utils/errors';
import { buildNormaKey } from '../../../utils/normaKeys';
import { resolveAct } from '../../../utils/actUrn';
import { ReadingBackControl } from './ReadingBackControl';
import { matchesSearchFilters } from '../../../utils/searchFilters';
import { deriveVersionInfo, requestIsHistorical, versionTabSuffix } from '../../../utils/versionDisplay';
import { parseSearchDeepLink, SEARCH_PARAM } from '../../../utils/deepLinks';
import { legalFetch } from '../../../services/legalFetch';
import { shortAct } from '../../../utils/sources';
import { WORKSPACE_AREA_ID } from '../../../utils/workspaceOrigin';
import { isPracticeTableEnabled } from '../../../features/practice/featureFlag';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { besideRefFor, findPracticeArticle, practiceArticleKey } from '../../../utils/practice';
import { actKeyOf } from '../dossier/dossierLayout';
import type { PracticeStreaming } from '../practice/PracticeParts';

// The practice's table (spec 2026-10-08-norm-tab-container-design.md, behind
// VITE_FEATURE_PRACTICE_TABLE): loaded only when the flag draws it, so the old
// workspace's bundle carries none of it.
// The desktop's row: the table and the windows beside it (P4).
const ReadingRow = lazy(() => import('../practice/ReadingRow').then(m => ({ default: m.ReadingRow })));
const PracticeBar = lazy(() => import('../practice/PracticeBar').then(m => ({ default: m.PracticeBar })));
const PracticePhoneView = lazy(() => import('../practice/PracticePhoneView').then(m => ({ default: m.PracticePhoneView })));
const PracticeNotice = lazy(() => import('../practice/PracticeParts').then(m => ({ default: m.PracticeNotice })));

/** A row a search added to a practice (it was not there before): the annex auto-switch removes
 *  the stray rows of the first search, and only those (spec §5.2). */
interface CreatedRow { practiceId: string; actId: string; articleKey: string }
/** The bar of practices floats `bottom-6`: 24 px. */
const BAR_OFFSET = 24;
/** Where the way back floats on a phone, flag on: above the services pill (`bottom-3`, a line tall) and
 *  the feedback button (`bottom-6`, 48 px), which sit under it. */
const PHONE_BACK_OFFSET = 80;
/** On the desktop before the bar is measured: its least height (`--practice-bar-height`'s 3.75rem). */
const BAR_MIN_HEIGHT = 60;

/** The rows one search created, named by the search's own params (the object `handleSearch` got). */
interface CreatedRows { search: SearchParams | null; rows: CreatedRow[] }

// Estimate the number of articles a search will return based on the `article`
// field. Used both for the streaming progress bar and the loading skeleton.
const calculateExpectedArticles = (article: string): number => {
  if (!article) return 0;

  // Handle ranges (e.g., "1-10")
  const rangeMatch = article.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1]);
    const end = parseInt(rangeMatch[2]);
    return Math.abs(end - start) + 1;
  }

  // Handle comma-separated (e.g., "1,2,3")
  if (article.includes(',')) {
    return article.split(',').filter(a => a.trim()).length;
  }

  // Single article
  return 1;
};

export function SearchPanel() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partialErrors, setPartialErrors] = useState<string[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [loadingProgress, setLoadingProgress] = useState<{ loaded: number; total?: number } | null>(null);
  const {
    addWorkspaceTab, addNormaToTab, addNormaIndexToTab, workspaceTabs, removeArticleFromNorma, removeTab,
    focusArticleInTab,
    searchTrigger, clearSearchTrigger,
    searchQueue, drainNextSearch,
    quickNorms, selectQuickNorm, triggerSearch,
    commandPaletteOpen, openCommandPalette, closeCommandPalette,
    pendingDecision, drainPendingDecision,
    mobileActiveTabId, setMobileActiveTabId,
    quickNormsManagerOpen, openQuickNormsManager, closeQuickNormsManager
  } = useAppStore(useShallow(s => ({
    addWorkspaceTab: s.addWorkspaceTab,
    addNormaToTab: s.addNormaToTab,
    addNormaIndexToTab: s.addNormaIndexToTab,
    workspaceTabs: s.workspaceTabs,
    removeArticleFromNorma: s.removeArticleFromNorma,
    removeTab: s.removeTab,
    focusArticleInTab: s.focusArticleInTab,
    searchTrigger: s.searchTrigger,
    clearSearchTrigger: s.clearSearchTrigger,
    searchQueue: s.searchQueue,
    drainNextSearch: s.drainNextSearch,
    quickNorms: s.quickNorms,
    selectQuickNorm: s.selectQuickNorm,
    triggerSearch: s.triggerSearch,
    commandPaletteOpen: s.commandPaletteOpen,
    openCommandPalette: s.openCommandPalette,
    closeCommandPalette: s.closeCommandPalette,
    pendingDecision: s.pendingDecision,
    drainPendingDecision: s.drainPendingDecision,
    mobileActiveTabId: s.mobileActiveTabId,
    setMobileActiveTabId: s.setMobileActiveTabId,
    quickNormsManagerOpen: s.quickNormsManagerOpen,
    openQuickNormsManager: s.openQuickNormsManager,
    closeQuickNormsManager: s.closeQuickNormsManager,
  })));
  const [resultsBuffer, setResultsBuffer] = useState<Record<string, { norma: Norma, articles: ArticleData[], versionDate?: string }>>({});
  const [customTabLabel, setCustomTabLabel] = useState<string | null>(null);
  // Remember the expected article count for the current search so the loading
  // skeleton can render a meaningful number of placeholder cards (M-4).
  const [expectedSkeletonCount, setExpectedSkeletonCount] = useState<number>(1);

  // Track active streaming tab to avoid creating duplicates
  const streamingTabRef = useRef<{ normaKey: string; tabId: string } | null>(null);

  // The practices (flag on): one layout per breakpoint (T4, gotcha 26); the practice the current
  // search lands in (its first result decides, the rest follow it); the rows it created.
  const practiceTable = isPracticeTableEnabled();
  const isDesktop = useIsDesktop();
  const practiceCount = useAppStore((s) => s.practices.length);
  const streamingPracticeRef = useRef<string | null>(null);
  const [streamingPracticeId, setStreamingPracticeId] = useState<string | null>(null);
  const createdRowsRef = useRef<CreatedRows>({ search: null, rows: [] });
  // A search started from a light window (a norm cited in its text): the window that asked and its
  // practice. The search lands there, and its first article opens beside the window, once.
  const askerRef = useRef<{ practiceId: string; windowId: string; opened: boolean } | null>(null);
  // The annex auto-switch (§5.2): the first search's stray rows, taken off once the annex search has
  // landed an article (`pendingStrayRef` until that search starts, then `strayRowsRef`); a failed
  // annex search leaves the act as it was.
  const pendingStrayRef = useRef<CreatedRow[]>([]);
  const strayRowsRef = useRef<CreatedRow[]>([]);
  // The bar of practices floats over the table (§3.4): its height, measured, keeps the column clear.
  const [practiceBarHeight, setPracticeBarHeight] = useState<number | null>(null);

  // R2 (streaming-ux): how many articles the current search is expected to
  // produce. When it's exactly 1, processResult auto-focuses the single
  // result (even when merged into an existing tab via R3). Above 1 we
  // stay out of the way per R1.
  const expectedTotalRef = useRef<number>(0);
  const deepLinkFocusRef = useRef<string | null>(null);
  // Search filters drop streamed articles client-side. Count what they drop
  // and what got through, so a search the filters emptied says so instead of
  // looking like a search that returned nothing.
  const filteredOutRef = useRef(0);
  const acceptedRef = useRef(0);

  // Abort in-flight streaming fetch when a new search starts or component unmounts
  const streamAbortRef = useRef<AbortController | null>(null);

  // Mobile: the tab on screen, kept in the store (the find window's «Questa scheda» reads it, and its
  // «go to» sets it through `revealTab`). An id no longer open reads as the first tab; `removeTab`
  // moves it to the neighbour when the tab on screen is the one closed.
  const mobileActiveTabIndex = Math.max(0, workspaceTabs.findIndex((t) => t.id === mobileActiveTabId));
  const setMobileActiveTabIndex = (index: number) => {
    const tab = workspaceTabs[index];
    if (tab) setMobileActiveTabId(tab.id);
  };

  // Mobile shows one tab at a time. Opening a decision (a new frontmost tab with a `view`, or an
  // open one brought to the front again, which raises its zIndex) makes it the visible one. The
  // reader's own swipes, chevrons and dots never touch a zIndex, so a later render never undoes them.
  // (gotcha 11: this follows an external change of the store, and there is nothing to derive the
  // phone's tab from during render.)
  const frontTabRef = useRef<string | null>(null);
  const frontTabSeenRef = useRef(false);
  useEffect(() => {
    let front: (typeof workspaceTabs)[number] | undefined;
    for (const t of workspaceTabs) if (!front || t.zIndex > front.zIndex) front = t;
    const previous = frontTabRef.current;
    frontTabRef.current = front ? `${front.id}:${front.zIndex}` : null;
    // the first run only records what is in front at mount
    if (!frontTabSeenRef.current) { frontTabSeenRef.current = true; return; }
    if (front?.view && frontTabRef.current !== previous) setMobileActiveTabId(front.id);
  }, [workspaceTabs, setMobileActiveTabId]);

  // A decision asked for from outside the search space (the `/sentenze/…` address) is opened here, on
  // every change of the request: the address may queue it after this panel has mounted.
  useEffect(() => {
    if (pendingDecision) drainPendingDecision();
  }, [pendingDecision, drainPendingDecision]);

  // PDF State
  const [pdfState, setPdfState] = useState<{ isOpen: boolean; url: string | null; isLoading: boolean }>({
    isOpen: false,
    url: null,
    isLoading: false
  });

  // `tabLabel` is the per-search custom label (e.g. from a dossier). It must
  // be threaded through as a parameter rather than read from `customTabLabel`
  // state, otherwise a queued multi-search (see triggerMultiSearch) closes
  // over a stale label captured when the memoized callback was created — the
  // second search would end up landing in a default-label tab. See the drain
  // effect below for the flow.
  const processResult = useCallback((result: ArticleData, versionDate?: string, isStreaming = false, tabLabel?: string, targetTabId?: string, filters?: SearchParams['filters'], version?: SearchParams['version']) => {
    if (result.error) {
      console.error("Backend Error for item:", result.error);
      const article = result.norma_data?.numero_articolo || 'richiesto';
      setPartialErrors(prev => [...prev, `Art. ${article}: ${result.error}`]);
      return;
    }

    const normaData = result.norma_data;

    if (!normaData) {
      console.error("Received result without norma_data", result);
      return;
    }

    // What was ASKED for: a date, or the original text. What came back is
    // `result.validity`, the window the source states; never an echo of the date.
    result.versionInfo = deriveVersionInfo({ version, version_date: versionDate });

    if (!matchesSearchFilters(result, filters)) {
      filteredOutRef.current += 1;
      return;
    }
    acceptedRef.current += 1;

    const norma: Norma = {
      tipo_atto: normaData.tipo_atto,
      data: normaData.data,
      numero_atto: normaData.numero_atto,
      tipo_atto_reale: normaData.tipo_atto_reale,
      urn: normaData.url
    };

    const key = buildNormaKey(norma);
    if (!key) return;

    // If streaming, add directly to workspace instead of buffering
    if (isStreaming) {
      const isHistorical = result.versionInfo?.isHistorical;

      // Update loading progress
      setLoadingProgress(prev => prev ? { ...prev, loaded: prev.loaded + 1 } : { loaded: 1 });

      // Check if we're streaming to the same norma as before
      const isSameNorma = streamingTabRef.current && streamingTabRef.current.normaKey === key;

      const numero = result.norma_data.numero_articolo;
      const allegato = result.norma_data.allegato;
      const articleUniqueId = allegato ? `all${allegato}:${numero}` : numero;

      // The practices (spec §5.1, T11): the dossier's practice (`targetTabId`, gotcha 15), else the
      // one this search already landed in, else the active one, created when there is none. Which
      // rows open (§3.2): the one article a one-article search asked for (R2), the first article of
      // an act new to the practice in a range (R1), the article a deep link names; never on the
      // dossier's queue, which would jump to every article as it lands.
      if (isPracticeTableEnabled()) {
        const store = appStore.getState();
        // Once the first article has landed, the rest follow it: a closed target is warned once per search.
        const asker = askerRef.current;
        const wanted = streamingPracticeRef.current ?? targetTabId ?? asker?.practiceId ?? null;
        const landingId = wanted && store.practices.some((p) => p.id === wanted) ? wanted : store.activePracticeId;
        const heldAct = store.practices.find((p) => p.id === landingId)?.acts.find((a) => a.key === actKeyOf(norma));
        const articleKey = practiceArticleKey(result);
        const isNewRow = !heldAct?.articles.some((a) => practiceArticleKey(a) === articleKey);
        const isDeepLinkTarget = deepLinkFocusRef.current === articleUniqueId;
        // A norm cited in a window opens beside it, not in the table.
        const reveal = isDeepLinkTarget || (!targetTabId && !asker && (expectedTotalRef.current === 1 || !heldAct));
        const landed = store.addArticlesToPractice(wanted, norma, [result], {
          ...(reveal ? { reveal: 'first' as const } : {}),
          ...(tabLabel ? { label: tabLabel } : {}),
        });
        if (streamingPracticeRef.current !== landed.practiceId) {
          streamingPracticeRef.current = landed.practiceId;
          setStreamingPracticeId(landed.practiceId);
        }
        if (isNewRow) createdRowsRef.current.rows.push({ practiceId: landed.practiceId, actId: landed.actId, articleKey });
        if (asker && !asker.opened) {
          asker.opened = true;
          store.openBeside(landed.practiceId, besideRefFor({ kind: 'article', actId: landed.actId, articleKey }), asker.windowId);
        }
        if (strayRowsRef.current.length > 0) {
          // The annex's article is on the table: the main text's stray rows go (never the one just landed).
          const strays = strayRowsRef.current.filter((row) => row.articleKey !== articleKey || row.actId !== landed.actId);
          strayRowsRef.current = [];
          for (const row of strays) store.removePracticeArticle(row.practiceId, row.actId, row.articleKey);
        }
        if (isDeepLinkTarget) deepLinkFocusRef.current = null;
        return;
      }

      // Direct-merge path: when the caller pre-created a tab (dossier "apri
      // tutto") and passed its id, we bypass all label-matching logic and
      // always merge into that tab. Also binds streamingTabRef so subsequent
      // articles from the same norma continue writing there.
      if (targetTabId && workspaceTabs.some((t) => t.id === targetTabId)) {
        addNormaToTab(targetTabId, norma, [result]);
        streamingTabRef.current = { normaKey: key, tabId: targetTabId };
      } else if (isSameNorma && streamingTabRef.current) {
        // Add article to the tab we created for this streaming session
        addNormaToTab(streamingTabRef.current.tabId, norma, [result]);
      } else {
        // First article of a new norma.
        //
        // Custom-label search (dossier "apri tutti"): first look for an
        // already-open custom tab with the SAME label and merge into it —
        // this is how a multi-norm dossier collapses into a single tab.
        // Fall back to creating a new custom tab.
        //
        // Non-custom search: R3 (streaming-ux) — merge into an existing
        // non-custom, non-historical tab that already holds the same norma,
        // otherwise create a new default-labeled tab.
        let mergeTarget: typeof workspaceTabs[number] | undefined;
        if (tabLabel && !isHistorical) {
          mergeTarget = workspaceTabs.find(tab =>
            !tab.view &&
            tab.labelIsCustom &&
            tab.label === tabLabel &&
            !tab.content.some(item =>
              item.type === 'norma' && item.articles?.some(a => a.versionInfo?.isHistorical)
            )
          );
        } else if (!tabLabel && !isHistorical) {
          mergeTarget = workspaceTabs.find(tab =>
            !tab.labelIsCustom &&
            tab.content.some(item =>
              item.type === 'norma' &&
              item.norma.tipo_atto === norma.tipo_atto &&
              item.norma.numero_atto === norma.numero_atto &&
              item.norma.data === norma.data &&
              !item.articles?.some(a => a.versionInfo?.isHistorical)
            )
          );
        }

        if (mergeTarget) {
          addNormaToTab(mergeTarget.id, norma, [result]);
          streamingTabRef.current = { normaKey: key, tabId: mergeTarget.id };
        } else {
          const versionSuffix = isHistorical ? versionTabSuffix({ version, versionDate }) : '';
          const label = tabLabel || `${shortAct(norma)}${versionSuffix}`;
          const newTabId = addWorkspaceTab(label, norma, [result], { isCustom: !!tabLabel });
          streamingTabRef.current = { normaKey: key, tabId: newTabId };
        }

      }

      // R2 (streaming-ux): single-article searches auto-focus the result even
      // when merged into a pre-existing tab (R3). For ranges we let the user
      // stay on whatever they're reading (R1). Not on the targetTabId path:
      // the dossier "apri tutte" queue (gotcha 15) would otherwise jump to
      // each article as it lands. A deep link focuses the article it names
      // on any path, range included.
      const isDeepLinkTarget = deepLinkFocusRef.current === articleUniqueId;
      if (streamingTabRef.current && (isDeepLinkTarget || (expectedTotalRef.current === 1 && !targetTabId))) {
        focusArticleInTab(streamingTabRef.current.tabId, articleUniqueId);
        if (isDeepLinkTarget) deepLinkFocusRef.current = null;
      }
    } else {
      // Buffer results for batch processing
      setResultsBuffer(prev => {
        const existing = prev[key];
        const newArticles = existing ? [...existing.articles] : [];

        const isNewArticle = !newArticles.find(a => a.norma_data.numero_articolo === result.norma_data.numero_articolo);

        if (isNewArticle) {
          newArticles.push(result);
          newArticles.sort((a, b) => {
            const numA = parseInt(a.norma_data.numero_articolo) || 0;
            const numB = parseInt(b.norma_data.numero_articolo) || 0;
            return numA - numB;
          });
        } else {
          const idx = newArticles.findIndex(a => a.norma_data.numero_articolo === result.norma_data.numero_articolo);
          newArticles[idx] = result;
        }

        return {
          ...prev,
          [key]: { norma, articles: newArticles, versionDate }
        };
      });
    }
  }, [workspaceTabs, addNormaToTab, addWorkspaceTab, focusArticleInTab]);

  const handleSearch = useCallback(async (params: SearchParams) => {

    // Cancel any in-flight streaming fetch so its reader does not keep writing
    // into the workspace after this new search took over.
    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;

    setIsLoading(true);
    setError(null);
    setPartialErrors([]);
    filteredOutRef.current = 0;
    acceptedRef.current = 0;
    setResultsBuffer({}); // Clear buffer before new search
    streamingTabRef.current = null; // Reset streaming tab tracker
    streamingPracticeRef.current = null;
    setStreamingPracticeId(null);
    const askerPractice = isPracticeTableEnabled() && params.besideTabId
      ? appStore.getState().practices.find((p) => p.beside.some((b) => b.id === params.besideTabId))
      : undefined;
    askerRef.current = askerPractice && params.besideTabId
      ? { practiceId: askerPractice.id, windowId: params.besideTabId, opened: false }
      : null;
    createdRowsRef.current = { search: params, rows: [] };
    // Only the annex search the auto-switch asked for takes the stray rows over.
    strayRowsRef.current = params.annex ? pendingStrayRef.current : [];
    pendingStrayRef.current = [];

    const expectedTotal = calculateExpectedArticles(params.article || '');
    expectedTotalRef.current = expectedTotal;
    setLoadingProgress({ loaded: 0, total: expectedTotal });
    // Skeleton count: at least 1, at most 10, mirrors the expected article
    // count (M-4). Avoids a fixed 2-card skeleton for ranges like "1-50".
    setExpectedSkeletonCount(Math.min(Math.max(expectedTotal || 1, 1), 10));

    // Count of NDJSON lines that failed to parse so we can surface a summary
    // error once the stream ends (M-2). Local to this search run so a later
    // search starts clean.
    let parseFailures = 0;

    // A search started from another tab (a norm cited in a decision): once its first result has
    // landed, the tab that holds it goes beside that one, the asking tab on the left. Once per search.
    // (The practices place no tab: in P3 everything reads in the table.)
    let placed = !params.besideTabId || isPracticeTableEnabled();
    const placeBeside = () => {
      const destination = streamingTabRef.current?.tabId;
      if (placed || !destination || !params.besideTabId) return;
      placed = true;
      appStore.getState().placeTabsSideBySide(params.besideTabId, destination);
    };

    try {
      // Always use streaming endpoint (now supports Brocardi too!)
      const response = await legalFetch('/stream_article_text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error('Errore nella richiesta');

      // Stream results - articles appear as they're fetched
      if (!response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              const result = JSON.parse(line);
              processResult(result, params.version_date, true, params.tabLabel, params.targetTabId, params.filters, params.version);
              placeBeside();
            } catch (e) {
              parseFailures += 1;
              console.error("Error parsing line", line, e);
            }
          }
        }
      }

      // Process any remaining data in buffer
      if (buffer.trim()) {
        try {
          const result = JSON.parse(buffer);
          processResult(result, params.version_date, true, params.tabLabel, params.targetTabId, params.filters, params.version);
          placeBeside();
        } catch (e) {
          parseFailures += 1;
          console.error("Error parsing final buffer", e);
        }
      }

      // If any NDJSON lines were malformed, let the user know something was
      // dropped instead of silently showing a partial result (M-2).
      if (parseFailures > 0) {
        setError(
          `Errore durante lo streaming: ${parseFailures} ${parseFailures === 1 ? 'articolo non è stato elaborato' : 'articoli non sono stati elaborati'}.`
        );
      }

      if (filteredOutRef.current > 0 && acceptedRef.current === 0) {
        const dropped = filteredOutRef.current;
        setError(
          `Nessun articolo corrisponde ai filtri impostati: ${dropped} ${dropped === 1 ? 'articolo escluso' : 'articoli esclusi'}. Allenta i filtri nella ricerca (⌘K) e riprova.`
        );
      }

      // Save to search history (fire and forget - don't block on this).
      // Skip when unauthenticated: history is per-user and would only
      // produce 401 noise in the console otherwise.
      if (isAuthenticated()) {
        addToHistory({
          act_type: params.act_type,
          act_number: params.act_number,
          article: params.article,
          date: params.date,
          version: params.version,
        }).catch(err => {
          // Silently fail - history is not critical
          console.debug('Failed to save search history:', err);
        });
      }

      // Results buffer will be processed by useEffect below

    } catch (err) {
      // A new search (or unmount) aborted this stream — not a user-facing error.
      if ((err instanceof Error && err.name === 'AbortError') || controller.signal.aborted) {
        return;
      }
      setError(getErrorMessage(err) || "Si è verificato un errore.");
    } finally {
      // Only clear transient UI state if this controller is still the active one.
      // A newer search replaces streamAbortRef before reaching finally.
      if (streamAbortRef.current === controller) {
        setIsLoading(false);
        setLoadingProgress(null);
        setStreamingPracticeId(null);
        // An annex search that landed nothing leaves the first search's rows where they are.
        strayRowsRef.current = [];
        streamAbortRef.current = null;
      }
    }
  }, [processResult]);

  // On unmount: abort any in-flight stream (C-2) and drop the buffered
  // results + streaming tab ref (M-1) so nothing leaks into a future
  // SearchPanel mount if the user navigates away mid-batch.
  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      streamingTabRef.current = null;
      setResultsBuffer({});
    };
  }, []);

  // Process results buffer and create workspace tabs
  useEffect(() => {
    if (Object.keys(resultsBuffer).length > 0 && !isLoading && isPracticeTableEnabled()) {
      // The practices: every group joins the active practice (created when there is none, named
      // after the dossier's label when one was given); the first group's first row opens (R1/R2).
      Object.values(resultsBuffer).forEach((group, index) => {
        appStore.getState().addArticlesToPractice(null, group.norma, group.articles, {
          ...(index === 0 ? { reveal: 'first' as const } : {}),
          ...(customTabLabel ? { label: customTabLabel } : {}),
        });
      });
      setResultsBuffer({});
      setCustomTabLabel(null);
      return;
    }
    if (Object.keys(resultsBuffer).length > 0 && !isLoading) {

      // Use custom label if provided (e.g., from dossier), otherwise generate default
      const useCustomLabel = customTabLabel && Object.keys(resultsBuffer).length > 0;

      Object.values(resultsBuffer).forEach((group, index) => {
        // For historical versions, always create a new tab
        const isHistorical = group.articles.some(a => a.versionInfo?.isHistorical);

        const isCustomForThisGroup = !!useCustomLabel && index === 0;

        if (isHistorical) {
          // Create new tab with version date in label
          const versionSuffix = versionTabSuffix({
            version: group.articles[0]?.norma_data.versione,
            versionDate: group.versionDate,
          }) || ' — testo storico';
          const label = isCustomForThisGroup
            ? customTabLabel!
            : `${shortAct(group.norma)}${versionSuffix}`;
          addWorkspaceTab(label, group.norma, group.articles, { isCustom: isCustomForThisGroup });
        } else {
          // R3 (streaming-ux): merge into an existing tab that holds the
          // same norma, but only if that tab is not reserved (labelIsCustom)
          // and is not a historical view.
          //
          // Custom-label searches (dossier "apri tutti") previously always
          // forked a new tab, which prevented a multi-norm dossier from
          // landing in a single tab. Now: a custom-labeled search tries to
          // merge into an existing custom-labeled tab with the SAME LABEL —
          // so sequential dossier searches all collapse into the dossier's
          // one tab (see dossier `triggerMultiSearch` queue).
          const existingTab = isCustomForThisGroup
            ? workspaceTabs.find(tab =>
                !tab.view &&
                tab.labelIsCustom &&
                tab.label === customTabLabel &&
                !tab.content.some(item =>
                  item.type === 'norma' && item.articles?.some(a => a.versionInfo?.isHistorical)
                )
              )
            : workspaceTabs.find(tab =>
                !tab.labelIsCustom &&
                tab.content.some(item =>
                  item.type === 'norma' &&
                  item.norma.tipo_atto === group.norma.tipo_atto &&
                  item.norma.numero_atto === group.norma.numero_atto &&
                  item.norma.data === group.norma.data &&
                  !item.articles?.some(a => a.versionInfo?.isHistorical)
                )
              );

          if (existingTab) {
            addNormaToTab(existingTab.id, group.norma, group.articles);
          } else {
            const label = isCustomForThisGroup
              ? customTabLabel!
              : shortAct(group.norma);
            addWorkspaceTab(label, group.norma, group.articles, { isCustom: isCustomForThisGroup });
          }
        }
      });

      // Clear buffer and custom label after processing
      setResultsBuffer({});
      setCustomTabLabel(null);
    }
  }, [resultsBuffer, isLoading, addWorkspaceTab, addNormaToTab, workspaceTabs, customTabLabel]);

  useEffect(() => {
    const deepLinkValue = searchParams.get(SEARCH_PARAM);
    if (deepLinkValue) {
      const deepLink = parseSearchDeepLink(deepLinkValue);
      if (deepLink) {
        deepLinkFocusRef.current = deepLink.articleId || null;
        handleSearch(deepLink.params);
      } else {
        console.error('Invalid norma deep link');
      }
      const next = new URLSearchParams(searchParams);
      next.delete(SEARCH_PARAM);
      setSearchParams(next, { replace: true });
      return;
    }

    const shareValue = searchParams.get('share');
    if (shareValue) {
      try {
        const decoded = JSON.parse(atob(shareValue));
        if (decoded) {
          handleSearch(decoded);
        }
      } catch (e) {
        console.error('Invalid share link', e);
      }
      const next = new URLSearchParams(searchParams);
      next.delete('share');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, handleSearch]);

  // Listen for programmatic search triggers
  useEffect(() => {
    if (searchTrigger) {
      // Capture custom tab label before search
      if (searchTrigger.tabLabel) {
        setCustomTabLabel(searchTrigger.tabLabel);
      }
      handleSearch(searchTrigger);
      clearSearchTrigger();
    }
  }, [searchTrigger, handleSearch, clearSearchTrigger]);

  // Drain the multi-search queue one item at a time. We only fire the next
  // item when: nothing is loading, no trigger is pending, and the results
  // buffer has been drained by the tab-processor effect above. That way each
  // queued search runs end-to-end before the next starts — critical because
  // they share the same custom label and merge into the SAME tab via
  // `addNormaToTab`, which requires the tab to already exist when the 2nd
  // through Nth searches resolve.
  useEffect(() => {
    if (searchQueue.length === 0) return;
    if (isLoading) return;
    if (searchTrigger) return;
    if (Object.keys(resultsBuffer).length > 0) return;
    // Atomic inside the store: if another drain invocation (StrictMode) already
    // parked a searchTrigger, this one no-ops and we don't dequeue twice.
    drainNextSearch();
  }, [isLoading, searchTrigger, resultsBuffer, searchQueue, drainNextSearch]);

  // Auto-switch hook for annex detection
  const {
    registerSearch,
    dialogState: autoSwitchDialog,
    confirmSwitch,
    cancelSwitch,
    toast: annexToast,
    dismissToast: dismissAnnexToast
  } = useAutoSwitch({
    onSearch: handleSearch,
    isLoading,
    onRemoveDuplicateTabs: (params) => {
      // The practices close nothing: the annex's articles are rows of their own (`allegato` is in
      // the row's key). Only the rows the first search created are taken off (spec §5.2), named by
      // their ids — the request's number and date are not the result's (the palette sends a year,
      // and no number for a code) — and only once the annex search has landed an article.
      if (isPracticeTableEnabled()) {
        const created = createdRowsRef.current;
        pendingStrayRef.current = created.search === params ? created.rows : [];
        createdRowsRef.current = { search: null, rows: [] };
        return;
      }
      // Remove any existing tabs with the same norma (from the initial search without annex)
      const duplicateTabs = workspaceTabs.filter(tab =>
        tab.content.some(item =>
          item.type === 'norma' &&
          item.norma.tipo_atto.toLowerCase() === params.act_type.toLowerCase() &&
          item.norma.numero_atto === params.act_number &&
          item.norma.data === params.date
        )
      );

      duplicateTabs.forEach(tab => {
        removeTab(tab.id);
      });
    }
  });

  // Register search for auto-switch detection when search trigger is used
  useEffect(() => {
    if (searchTrigger && !searchTrigger.annex) {
      registerSearch(searchTrigger);
    }
  }, [searchTrigger, registerSearch]);

  const handleCrossReferenceNavigate = useCallback((articleNumber: string, normaData: ArticleData['norma_data'], askerId?: string) => {
    const params: SearchParams = {
      act_type: normaData.tipo_atto,
      act_number: normaData.numero_atto || '',
      date: normaData.data || '',
      article: articleNumber,
      version: (normaData.versione as 'vigente' | 'originale') || 'vigente',
      version_date: normaData.data_versione || '',
      show_brocardi_info: !requestIsHistorical(normaData),
      annex: normaData.allegato || undefined  // Preserve annex when navigating via cross-reference
    };
    // The practices: the text in force of an article of the same act already on the table is revealed,
    // not searched again (T2); a past text of it never stands in for it, so without its row the text
    // in force is loaded as a new row. A past text's jump asks for its own version, so it searches.
    // Cited from a light window (`askerId`), the row opens beside that window instead of being
    // revealed in the table (spec §4.5), and a search it needs starts from the window.
    if (isPracticeTableEnabled() && !requestIsHistorical(normaData)) {
      const { practices, activePracticeId, revealPracticeRow, openBeside } = appStore.getState();
      const askerPractice = askerId ? practices.find((p) => p.beside.some((b) => b.id === askerId)) : undefined;
      const practice = askerPractice ?? practices.find((p) => p.id === activePracticeId);
      const act = practice?.acts.find((a) => a.key === actKeyOf(normaData));
      const articleId = normaData.allegato ? `all${normaData.allegato}:${articleNumber}` : articleNumber;
      const inForce = act && findPracticeArticle(
        { ...act, articles: act.articles.filter((a) => !requestIsHistorical(a.norma_data)) }, articleId);
      if (practice && act && inForce) {
        if (askerPractice) {
          openBeside(practice.id, besideRefFor({ kind: 'article', actId: act.id, articleKey: practiceArticleKey(inForce) }), askerId);
          return;
        }
        if (revealPracticeRow(practice.id, act.id, practiceArticleKey(inForce))) return;
      }
    }
    handleSearch(askerId ? { ...params, besideTabId: askerId } : params);
  }, [handleSearch]);


  /**
   * "Open a code and browse" — the entry point the app never had.
   *
   * Resolves the act's URN structurally (no article text is fetched), drops an
   * article-less block on the active tab and points the structure window at
   * it. From there every pick loads into that block.
   */
  const handleBrowseStructure = useCallback(async (params: SearchParams) => {
    setError(null);
    try {
      // The resolved identity, not the requested one: asking for "codice
      // civile" comes back as regio decreto 262/1942, and a block built from
      // the request would never match that same act arriving from a later
      // search — the workspace would grow a duplicate tab for it.
      const { norma } = await resolveAct({
        act_type: params.act_type,
        act_number: params.act_number || undefined,
        date: params.date || undefined,
      });

      // The practices: the act lands on the active practice (created when there is none) and the
      // structure window points at it, in one step (spec §5.1).
      if (isPracticeTableEnabled()) {
        appStore.getState().addActIndexToPractice(null, norma);
        return;
      }

      // Land on the tab the user is already working in; only open a new one
      // when the workspace is empty.
      //
      // Deliberately NOT `{ isCustom: true }`: a custom-labelled tab is
      // excluded from processResult's merge heuristics, so every later search
      // for this act — a citation jump included — would spawn a duplicate tab.
      // That is the accumulation this round exists to reduce.
      // (a decision tab draws no content list, so the index would land where nothing shows it)
      const lastNormTab = [...workspaceTabs].reverse().find((t) => !t.view);
      const targetTabId = lastNormTab ? lastNormTab.id : addWorkspaceTab(params.act_type);

      addNormaIndexToTab(targetTabId, norma);
    } catch (e) {
      // Loud on purpose: the user asked for a door and must be told when it
      // does not open (CLAUDE.md gotcha #18 — no silent fallbacks).
      console.error('handleBrowseStructure: URN resolution failed:', e);
      setError(getErrorMessage(e) || "Impossibile aprire l'indice di questo atto.");
    }
  }, [workspaceTabs, addWorkspaceTab, addNormaIndexToTab]);

  const handleViewPdf = async (urn: string) => {
    setPdfState({ isOpen: true, url: null, isLoading: true });
    try {
      const response = await legalFetch('/export_pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urn })
      });

      if (!response.ok) throw new Error('Errore generazione PDF');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      setPdfState({ isOpen: true, url, isLoading: false });
    } catch (e) {
      console.error(e);
      setPdfState({ isOpen: false, url: null, isLoading: false });
      setError("Impossibile caricare il PDF.");
    }
  };

  const hasTabs = practiceTable ? practiceCount > 0 : workspaceTabs.length > 0;
  const activeMobileTab = workspaceTabs[mobileActiveTabIndex];
  const practiceStreaming: PracticeStreaming | null = loadingProgress && streamingPracticeId
    ? { practiceId: streamingPracticeId, ...loadingProgress }
    : null;

  return (
    <>
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={closeCommandPalette}
        onSearch={handleSearch}
        onBrowseStructure={handleBrowseStructure}
      />

      {/* One global control: the back-stack is global, so a per-tab copy would
          sit inside the very tab an entry points at. */}
      <ReadingBackControl
        // With the practices it floats above the bar, clear of the act's heading and the windows' headers.
        placement={practiceTable ? 'bottom' : 'top'}
        bottomOffset={isDesktop ? (practiceBarHeight ?? BAR_MIN_HEIGHT) + BAR_OFFSET + 12 : PHONE_BACK_OFFSET}
        onNavigated={(tabId) => {
          // The practices: going back already made the practice active, which both breakpoints draw.
          if (!practiceTable && workspaceTabs.some(t => t.id === tabId)) setMobileActiveTabId(tabId);
        }}
      />

      {/* The practices (flag on): the table and the bar on the desktop, the phone's table below md;
          one layout mounted (T4, gotcha 26), loaded only here. */}
      {practiceTable && (
        <Suspense fallback={null}>
          {/* Mounted over both layouts: a notice not yet closed survives a change of breakpoint. */}
          <PracticeNotice />
          {isDesktop ? (
            <>
              <div
                id={WORKSPACE_AREA_ID}
                className="w-full"
                // The column's bottom padding reads it (§3.4); without the bar, its fallback.
                style={practiceBarHeight === null ? undefined : { ['--practice-bar-height' as string]: `${practiceBarHeight}px` }}
              >
                <ReadingRow onViewPdf={handleViewPdf} onCrossReference={handleCrossReferenceNavigate} streaming={practiceStreaming} />
              </div>
              <PracticeBar onHeightChange={setPracticeBarHeight} />
            </>
          ) : (
            <PracticePhoneView onViewPdf={handleViewPdf} onCrossReference={handleCrossReferenceNavigate} streaming={practiceStreaming} />
          )}
        </Suspense>
      )}

      {/* Workspace Manager - renders all tabs */}
      {/* Desktop: Workspace floating panels - hidden on mobile */}
      {!practiceTable && (<>
      <div id={WORKSPACE_AREA_ID} className="hidden md:block">
        <WorkspaceManager
          onViewPdf={handleViewPdf}
          onCrossReference={handleCrossReferenceNavigate}
        />
      </div>

      {/* Desktop: Workspace Navigator dock - hidden on mobile */}
      <div className="hidden md:block">
        <WorkspaceNavigator />
      </div>

      {/* Mobile: Swipeable tabs navigation */}
      {hasTabs && (
        <div className="md:hidden w-full h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
          {/* Tab header with navigation - Glass aesthetic. The layout's fixed menu button (top-left,
              16px in, 56px wide) sits over the header's left edge: the inset keeps the previous-tab
              chevron clear of it. */}
          <div data-testid="phone-tab-header" className="flex-shrink-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800 pl-[4.5rem] pr-4 py-4">
            <div className="flex items-center justify-between">
              {/* Prev button */}
              <button
                onClick={() => setMobileActiveTabIndex(Math.max(0, mobileActiveTabIndex - 1))}
                disabled={mobileActiveTabIndex === 0}
                aria-label="Tab precedente"
                className={cn(
                  "p-2.5 rounded-xl transition-all shadow-sm active:scale-95",
                  mobileActiveTabIndex === 0
                    ? "text-slate-300 dark:text-slate-700 bg-slate-50 dark:bg-slate-900"
                    : "text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
                )}
              >
                <ChevronLeft size={20} />
              </button>

              {/* Tab label and indicator */}
              <div className="flex-1 text-center min-w-0 px-4">
                <p className="font-bold text-slate-900 dark:text-white text-base truncate">
                  {workspaceTabs[mobileActiveTabIndex]?.label || 'Risultati'}
                </p>
                {/* Dots indicator */}
                <div className="flex justify-center gap-1.5 mt-2.5">
                  {workspaceTabs.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setMobileActiveTabIndex(idx)}
                      className={cn(
                        "h-1.5 rounded-full transition-all duration-300",
                        idx === mobileActiveTabIndex
                          ? "w-6 bg-primary-500 shadow-glow-sm"
                          : "w-1.5 bg-slate-300 dark:bg-slate-700"
                      )}
                    />
                  ))}
                </div>
              </div>

              {/* Next button */}
              <button
                onClick={() => setMobileActiveTabIndex(Math.min(workspaceTabs.length - 1, mobileActiveTabIndex + 1))}
                disabled={mobileActiveTabIndex === workspaceTabs.length - 1}
                aria-label="Tab successiva"
                className={cn(
                  "p-2.5 rounded-xl transition-all shadow-sm active:scale-95",
                  mobileActiveTabIndex === workspaceTabs.length - 1
                    ? "text-slate-300 dark:text-slate-700 bg-slate-50 dark:bg-slate-900"
                    : "text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
                )}
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>

          {/* Swipeable content area */}
          <div className="flex-1 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              {workspaceTabs[mobileActiveTabIndex] && (
                <motion.div
                  key={workspaceTabs[mobileActiveTabIndex].id}
                  initial={{ opacity: 0, x: 50 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -50 }}
                  transition={{ duration: 0.3, ease: "circOut" }}
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.2}
                  onDragEnd={(_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
                    const threshold = 50;
                    if (info.offset.x > threshold && mobileActiveTabIndex > 0) {
                      setMobileActiveTabIndex(mobileActiveTabIndex - 1);
                    } else if (info.offset.x < -threshold && mobileActiveTabIndex < workspaceTabs.length - 1) {
                      setMobileActiveTabIndex(mobileActiveTabIndex + 1);
                    }
                  }}
                  className="h-full overflow-y-auto p-4 space-y-4 custom-scrollbar"
                >
                  {activeMobileTab?.view && renderTabView(activeMobileTab, activeMobileTab.view)}
                  {workspaceTabs[mobileActiveTabIndex].content
                    .filter((item): item is typeof item & { type: 'norma' } => item.type === 'norma')
                    .map((normaBlock) => {
                      const tabIsStreaming =
                        isLoading &&
                        streamingTabRef.current?.tabId === workspaceTabs[mobileActiveTabIndex].id;
                      return (
                        <NormaCard
                          key={normaBlock.id}
                          norma={normaBlock.norma}
                          articles={normaBlock.articles || []}
                          tabId={workspaceTabs[mobileActiveTabIndex].id}
                          normaBlockId={normaBlock.id}
                          autoFocusArticleId={normaBlock.autoFocusArticleId}
                          onCloseArticle={(articleId) => {
                            removeArticleFromNorma(workspaceTabs[mobileActiveTabIndex].id, normaBlock.id, articleId);
                          }}
                          onViewPdf={handleViewPdf}
                          onCrossReference={handleCrossReferenceNavigate}
                          isStreaming={tabIsStreaming}
                          streamProgress={tabIsStreaming ? loadingProgress : null}
                        />
                      );
                    })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
      </>)}

      {/* QuickNorms Manager Modal */}
      <QuickNormsManager
        isOpen={quickNormsManagerOpen}
        onClose={closeQuickNormsManager}
        onSearch={handleSearch}
      />

      {/* Alias Manager Modal */}
      <AliasManager />

      {/* Main Content Area - Empty state when no tabs */}
      {!hasTabs && !isLoading && (
        <div id="tour-main-content" className="w-full h-full flex flex-col items-center justify-center p-8 animate-in fade-in duration-700 bg-slate-50 dark:bg-slate-950">
          {/* Interactive Search Icon */}
          <div
            className="relative group cursor-pointer active:scale-95 transition-transform"
            onClick={openCommandPalette}
            title="Apri ricerca (Cmd+K)"
          >
            {/* Blur Background */}
            <div className="absolute inset-0 bg-primary-500/20 rounded-[2.5rem] blur-2xl group-hover:bg-primary-500/30 transition-all duration-700 animate-pulse" />

            {/* Icon Container - Glass Card */}
            <div className="relative w-32 h-32 sm:w-40 sm:h-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-[2.5rem] shadow-glass-lg flex items-center justify-center border border-white dark:border-slate-800 transition-all duration-500 group-hover:shadow-primary-500/10 group-hover:-translate-y-2">
              <Search size={64} className="text-primary-500 stroke-[1.2] w-14 h-14 sm:w-16 sm:h-16 group-hover:scale-110 transition-transform duration-500" />
              <span className="sr-only">Apri la ricerca</span>

              {/* Keyboard Shortcut Badge */}
              <div className="absolute -bottom-2 -right-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[10px] font-black px-3 py-1.5 rounded-full shadow-lg border-4 border-slate-50 dark:border-slate-950 uppercase tracking-widest">
                ⌘ K
              </div>
            </div>
            <button
              onClick={openCommandPalette}
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold shadow-md hover:shadow-lg transition-all focus-ring"
            >
              <Search size={16} />
              Inizia una ricerca
            </button>
            </div>

          {/* Title and Description */}
          <div className="text-center mt-10 mb-8 max-w-xl">
            <h3 className="text-3xl font-black text-slate-900 dark:text-white mb-3 tracking-tight">
              Ricerca Intelligente
            </h3>
            <p className="text-slate-500 dark:text-slate-400 text-lg leading-relaxed font-medium">
              Scrivi una citazione naturale: non serve compilare tutti i campi.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-5" aria-label="Esempi di ricerca">
              {["Art. 2043 c.c.", "Art. 5 GDPR", "Art. 1 Costituzione"].map((example) => (
                <button
                  key={example}
                  onClick={openCommandPalette}
                  className="px-3 py-1.5 rounded-full border border-primary-200 dark:border-primary-800 bg-primary-50/70 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 text-xs font-semibold hover:bg-primary-100 dark:hover:bg-primary-900/60 transition-colors focus-ring"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>

          {/* QuickNorms Section */}
          <div id="tour-quick-norms" className="w-full max-w-2xl px-4">
            <div className="flex items-center justify-between mb-6 px-2">
              <div className="flex items-center gap-2.5 text-xs font-bold text-slate-400 uppercase tracking-widest">
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
                  <Star size={14} fill="currentColor" />
                </div>
                <span>Ricerche Frequenti</span>
              </div>
              <button
                onClick={openQuickNormsManager}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider",
                  "bg-slate-200/50 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700",
                  "text-slate-600 dark:text-slate-300 transition-all shadow-sm active:scale-95 border border-slate-300 dark:border-slate-700"
                )}
              >
                <Plus size={14} />
                Gestisci
              </button>
            </div>

            {quickNorms.length === 0 ? (
              <div
                onClick={openQuickNormsManager}
                className={cn(
                  "group flex flex-col items-center justify-center py-12 px-8 rounded-3xl cursor-pointer",
                  "border-2 border-dashed border-slate-200 dark:border-slate-800",
                  "hover:border-primary-400/50 dark:hover:border-primary-500/50 hover:bg-primary-50/30 dark:hover:bg-primary-900/10",
                  "transition-all duration-300"
                )}
              >
                <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-900 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Sparkles size={28} className="text-slate-400 dark:text-slate-500 group-hover:text-primary-500 transition-colors" />
                </div>
                <p className="text-base text-slate-500 dark:text-slate-400 text-center font-bold">
                  Velocizza il tuo workflow<br />
                  <span className="text-xs font-medium text-slate-400 mt-1 block">Aggiungi norme consultate frequentemente</span>
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {quickNorms.slice(0, 6).map((qn) => (
                  <button
                    key={qn.id}
                    onClick={() => {
                      selectQuickNorm(qn.id);
                      triggerSearch(qn.searchParams);
                    }}
                    className={cn(
                      "group flex flex-col gap-2 p-4 rounded-2xl text-left",
                      "bg-white dark:bg-slate-900",
                      "border border-slate-200 dark:border-slate-800",
                      "hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-xl hover:shadow-primary-500/5 hover:-translate-y-1",
                      "transition-all duration-300"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-500">
                        <Star size={12} fill="currentColor" />
                      </div>
                      <ChevronRight size={14} className="text-slate-300 group-hover:text-primary-500 transition-colors" />
                    </div>
                    <div>
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-100 line-clamp-1">{qn.label}</span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight mt-0.5">{qn.searchParams.act_type}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Loading Skeleton - Shows while search is in progress */}
      {isLoading && !hasTabs && (
        <div className="w-full max-w-4xl mx-auto p-12 space-y-8 animate-pulse">
          <div className="space-y-4">
            <div className="h-10 bg-slate-200 dark:bg-slate-800 rounded-2xl w-1/3" />
            <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-lg w-1/2" />
          </div>

          <div className="grid grid-cols-1 gap-6">
            {Array.from({ length: expectedSkeletonCount }, (_, i) => i + 1).map(i => (
              <div key={i} className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                <div className="p-8 space-y-6">
                  <div className="flex gap-4 items-center">
                    <div className="w-12 h-12 bg-slate-200 dark:bg-slate-800 rounded-2xl" />
                    <div className="space-y-2 flex-1">
                      <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded-md w-1/4" />
                      <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded-md w-1/6" />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="h-3 bg-slate-100 dark:bg-slate-800/50 rounded-md w-full" />
                    <div className="h-3 bg-slate-100 dark:bg-slate-800/50 rounded-md w-full" />
                    <div className="h-3 bg-slate-100 dark:bg-slate-800/50 rounded-md w-2/3" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading progress indicator */}
      <AnimatePresence>
        {loadingProgress && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className={cn('fixed top-24 left-1/2 w-full max-w-md px-4', Z_INDEX.searchPanel)}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className="bg-white dark:bg-slate-900 border border-primary-200 dark:border-primary-900/30 p-4 rounded-2xl shadow-lg shadow-primary-500/10 flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center text-primary-500">
                <div className="w-5 h-5 rounded-full border-2 border-current border-t-transparent animate-spin" />
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
                  Caricamento articoli...
                </h4>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed">
                  {loadingProgress.total
                    ? `${loadingProgress.loaded} di ${loadingProgress.total} articoli caricati`
                    : `${loadingProgress.loaded} articoli caricati`}
                </p>
                {/* Progress bar */}
                {loadingProgress.total && (
                  <div className="mt-2 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-primary-500 to-primary-600"
                      initial={{ width: 0 }}
                      animate={{ width: `${(loadingProgress.loaded / loadingProgress.total) * 100}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error display */}
      <AnimatePresence>
        {partialErrors.length > 0 && !error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={cn('fixed bottom-24 right-4 w-full max-w-md px-4', Z_INDEX.toast)}
            role="alert"
            aria-live="polite"
          >
            <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/40 p-4 rounded-2xl shadow-lg shadow-amber-500/10 flex items-start gap-3">
              <Info size={20} className="shrink-0 text-amber-500 mt-0.5" />
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Risultato parziale</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {partialErrors.length} {partialErrors.length === 1 ? 'articolo non è stato elaborato' : 'articoli non sono stati elaborati'}.
                </p>
                <ul className="mt-2 max-h-20 overflow-y-auto text-xs text-amber-700 dark:text-amber-300 space-y-1">
                  {partialErrors.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}
                </ul>
              </div>
              <button onClick={() => setPartialErrors([])} aria-label="Chiudi avviso risultato parziale" className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg focus-ring">
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={cn('fixed bottom-24 right-4 w-full max-w-md px-4', Z_INDEX.toast)}
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            <div className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/30 p-4 rounded-2xl shadow-lg shadow-red-500/10 flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center text-red-500">
                <SearchX size={20} />
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Errore di Ricerca</h4>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Annex Auto-Switch Toast Notification */}
      <AnimatePresence>
        {annexToast && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className={cn('fixed top-24 left-1/2 w-full max-w-md px-4', Z_INDEX.searchPanel)}
          >
            <div className="bg-white dark:bg-slate-900 border border-primary-200 dark:border-primary-900/30 p-4 rounded-2xl shadow-lg shadow-primary-500/10 flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center text-primary-500">
                <Info size={20} />
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Navigazione allegato</h4>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed">{annexToast.message}</p>
              </div>
              <button
                onClick={dismissAnnexToast}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Annex Switch Confirmation Dialog */}
      <AnnexSwitchDialog
        isOpen={autoSwitchDialog.showDialog}
        onConfirm={confirmSwitch}
        onCancel={cancelSwitch}
        articleNumber={autoSwitchDialog.articleNumber}
        annexLabel={autoSwitchDialog.annexLabel}
        annexNumber={autoSwitchDialog.annexNumber}
      />

      {/* PDF Viewer Modal — loaded only when explicitly opened */}
      <Suspense fallback={null}>
        <PDFViewer
          isOpen={pdfState.isOpen}
          onClose={() => setPdfState(s => ({ ...s, isOpen: false }))}
          pdfUrl={pdfState.url}
          isLoading={pdfState.isLoading}
        />
      </Suspense>
    </>
  );
}
