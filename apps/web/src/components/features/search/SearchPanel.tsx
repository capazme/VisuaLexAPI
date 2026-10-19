import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
const PDFViewer = lazy(() => import('../../ui/PDFViewer').then(m => ({ default: m.PDFViewer })));
import { AnnexSwitchDialog } from '../../ui/AnnexSwitchDialog';
import type { SearchParams, ArticleData, Norma } from '../../../types';
import { SearchX, X, Info } from 'lucide-react';
import { addToHistory } from '../../../services/historyService';
import { isAuthenticated } from '../../../services/authService';
import { useSearchParams } from 'react-router-dom';
import { appStore, useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../../lib/utils';
import { useAutoSwitch } from '../../../hooks/useAutoSwitch';
import { Z_INDEX } from '../../../constants/zIndex';
import { getErrorMessage } from '../../../utils/errors';
import { responseErrorMessage } from '../../../utils/responseError';
import { buildNormaKey } from '../../../utils/normaKeys';
import { ReadingBackControl } from './ReadingBackControl';
import { matchesSearchFilters } from '../../../utils/searchFilters';
import { isTypedSearch } from '../../../hooks/useSearchActions';
import { Scrivania } from './Scrivania';
import { BookMark } from '../../ui/BookMark';
import { deriveVersionInfo, requestIsHistorical } from '../../../utils/versionDisplay';
import { parseSearchDeepLink, SEARCH_PARAM } from '../../../utils/deepLinks';
import { legalFetch } from '../../../services/legalFetch';
import { WORKSPACE_AREA_ID } from '../../../utils/workspaceOrigin';
import { isDesktopViewport, useIsDesktop } from '../../../hooks/useIsDesktop';
import { besideRefFor, findPracticeArticle, practiceArticleKey } from '../../../utils/practice';
import { actKeyOf } from '../dossier/dossierLayout';
import { PracticeNotice, type PracticeStreaming } from '../practice/PracticeParts';
import { ReadingRow } from '../practice/ReadingRow';
import { PracticeBar } from '../practice/PracticeBar';
import { PracticePhoneView } from '../practice/PracticePhoneView';
import { dur, ease } from '../../../lib/motion';

/** The practice whose light window or, on a phone, full-screen reader `askerId` names: where a norm
 *  cited in its text is searched and opened. */
function askerPracticeOf(askerId: string | undefined) {
  if (!askerId) return undefined;
  const { practices, phoneReader } = appStore.getState();
  return practices.find((p) => p.beside.some((b) => b.id === askerId)) ??
    (phoneReader?.ref.id === askerId ? practices.find((p) => p.id === phoneReader.practiceId) : undefined);
}

/** A subject opened from a light window or from the phone's reader: beside the window, or in the reader. */
function openFromAsker(practiceId: string, ref: ReturnType<typeof besideRefFor>, askerId: string): void {
  const { openBeside, openPhoneReader } = appStore.getState();
  if (isDesktopViewport()) openBeside(practiceId, ref, askerId);
  else openPhoneReader(practiceId, ref);
}

/** A row a search added to a practice (it was not there before): the annex auto-switch removes
 *  the stray rows of the first search, and only those (spec §5.2). */
interface CreatedRow { practiceId: string; actId: string; articleKey: string }
/** The bar of practices floats `bottom-6`: 24 px. */
const BAR_OFFSET = 24;
/** Where the way back floats on a phone: above the feedback button (`bottom-6`, 48 px), which sits
 *  under it. (It also cleared the services pill, now in the user menu, S1.) */
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
    searchTrigger, clearSearchTrigger,
    searchQueue, drainNextSearch,
    pendingDecision, drainPendingDecision,
  } = useAppStore(useShallow(s => ({
    searchTrigger: s.searchTrigger,
    clearSearchTrigger: s.clearSearchTrigger,
    searchQueue: s.searchQueue,
    drainNextSearch: s.drainNextSearch,
    pendingDecision: s.pendingDecision,
    drainPendingDecision: s.drainPendingDecision,
  })));
  const [resultsBuffer, setResultsBuffer] = useState<Record<string, { norma: Norma, articles: ArticleData[], versionDate?: string }>>({});
  const [customTabLabel, setCustomTabLabel] = useState<string | null>(null);
  // Remember the expected article count for the current search so the loading
  // skeleton can render a meaningful number of placeholder cards (M-4).
  const [expectedSkeletonCount, setExpectedSkeletonCount] = useState<number>(1);

  // One layout per breakpoint (T4, gotcha 26); the practice the current search lands in (its first
  // result decides, the rest follow it); the rows it created.
  const isDesktop = useIsDesktop();
  const practiceCount = useAppStore((s) => s.practices.length);
  const closePhoneReader = useAppStore((s) => s.closePhoneReader);
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
  // The phone's full-screen reader is closed when the screen widens: the desktop reads in windows (§8).
  useEffect(() => {
    if (isDesktop) closePhoneReader();
  }, [isDesktop, closePhoneReader]);
  // The bar of practices floats over the table (§3.4): its height, measured, keeps the column clear.
  const [practiceBarHeight, setPracticeBarHeight] = useState<number | null>(null);

  // R2 (streaming-ux): how many articles the current search is expected to
  // produce. When it's exactly 1, processResult opens the single result's
  // row (even in an act already on the table). Above 1 we stay out of the
  // way per R1.
  const expectedTotalRef = useRef<number>(0);
  const deepLinkFocusRef = useRef<string | null>(null);
  // Search filters drop streamed articles client-side. Count what they drop
  // and what got through, so a search the filters emptied says so instead of
  // looking like a search that returned nothing.
  const filteredOutRef = useRef(0);
  const acceptedRef = useRef(0);

  // Abort in-flight streaming fetch when a new search starts or component unmounts
  const streamAbortRef = useRef<AbortController | null>(null);

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
  // over a stale label captured when the memoized callback was created. See
  // the drain effect below for the flow.
  const processResult = useCallback((result: ArticleData, versionDate?: string, isStreaming = false, tabLabel?: string, targetPracticeId?: string, filters?: SearchParams['filters'], version?: SearchParams['version']) => {
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

    // If streaming, add directly to the practice instead of buffering
    if (isStreaming) {
      // Update loading progress
      setLoadingProgress(prev => prev ? { ...prev, loaded: prev.loaded + 1 } : { loaded: 1 });

      const numero = result.norma_data.numero_articolo;
      const allegato = result.norma_data.allegato;
      const articleUniqueId = allegato ? `all${allegato}:${numero}` : numero;

      // The practice (spec §5.1, T11): the dossier's practice (`targetPracticeId`, gotcha 15), else the
      // one this search already landed in, else the active one, created when there is none. Which
      // rows open (§3.2): the one article a one-article search asked for (R2), the first article of
      // an act new to the practice in a range (R1), the article a deep link names; never on the
      // dossier's queue, which would jump to every article as it lands.
      const store = appStore.getState();
      // Once the first article has landed, the rest follow it: a closed target is warned once per search.
      const asker = askerRef.current;
      const wanted = streamingPracticeRef.current ?? targetPracticeId ?? asker?.practiceId ?? null;
      const landingId = wanted && store.practices.some((p) => p.id === wanted) ? wanted : store.activePracticeId;
      const heldAct = store.practices.find((p) => p.id === landingId)?.acts.find((a) => a.key === actKeyOf(norma));
      const articleKey = practiceArticleKey(result);
      const isNewRow = !heldAct?.articles.some((a) => practiceArticleKey(a) === articleKey);
      const isDeepLinkTarget = deepLinkFocusRef.current === articleUniqueId;
      // A norm cited in a window opens beside it, not in the table.
      const reveal = isDeepLinkTarget || (!targetPracticeId && !asker && (expectedTotalRef.current === 1 || !heldAct));
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
        openFromAsker(landed.practiceId, besideRefFor({ kind: 'article', actId: landed.actId, articleKey }), asker.windowId);
      }
      if (strayRowsRef.current.length > 0) {
        // The annex's article is on the table: the main text's stray rows go (never the one just landed).
        const strays = strayRowsRef.current.filter((row) => row.articleKey !== articleKey || row.actId !== landed.actId);
        strayRowsRef.current = [];
        for (const row of strays) store.removePracticeArticle(row.practiceId, row.actId, row.articleKey);
      }
      if (isDeepLinkTarget) deepLinkFocusRef.current = null;
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
  }, []);

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
    streamingPracticeRef.current = null;
    setStreamingPracticeId(null);
    const askerPractice = askerPracticeOf(params.besideId);
    askerRef.current = askerPractice && params.besideId
      ? { practiceId: askerPractice.id, windowId: params.besideId, opened: false }
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

    try {
      // Always use streaming endpoint (now supports Brocardi too!)
      const response = await legalFetch('/stream_article_text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      // The API says why in Italian (a range whose index cannot be read, an article not in the act).
      if (!response.ok) throw new Error(await responseErrorMessage(response, 'Errore nella richiesta'));

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
              processResult(result, params.version_date, true, params.tabLabel, params.targetPracticeId, params.filters, params.version);
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
          processResult(result, params.version_date, true, params.tabLabel, params.targetPracticeId, params.filters, params.version);
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
  // results (M-1) so nothing leaks into a future SearchPanel mount if the
  // user navigates away mid-batch.
  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      setResultsBuffer({});
    };
  }, []);

  // Process the results buffer into the practice
  useEffect(() => {
    if (Object.keys(resultsBuffer).length > 0 && !isLoading) {
      // Every group joins the active practice (created when there is none, named after the dossier's
      // label when one was given); the first group's first row opens (R1/R2).
      Object.values(resultsBuffer).forEach((group, index) => {
        appStore.getState().addArticlesToPractice(null, group.norma, group.articles, {
          ...(index === 0 ? { reveal: 'first' as const } : {}),
          ...(customTabLabel ? { label: customTabLabel } : {}),
        });
      });
      setResultsBuffer({});
      setCustomTabLabel(null);
    }
  }, [resultsBuffer, isLoading, customTabLabel]);

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
      // Capture the label that names the practice (a dossier's) before search
      if (searchTrigger.tabLabel) {
        setCustomTabLabel(searchTrigger.tabLabel);
      }
      handleSearch(searchTrigger);
      clearSearchTrigger();
    }
  }, [searchTrigger, handleSearch, clearSearchTrigger]);

  // Drain the multi-search queue one item at a time. We only fire the next
  // item when: nothing is loading, no trigger is pending, and the results
  // buffer has been drained by the effect above. That way each queued search
  // runs end-to-end before the next starts — critical because they share the
  // dossier's practice (`targetPracticeId`), which must hold the earlier searches'
  // articles when the 2nd through Nth resolve.
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
    onReplaceFirstSearch: (params) => {
      // The practices close nothing: the annex's articles are rows of their own (`allegato` is in
      // the row's key). Only the rows the first search created are taken off (spec §5.2), named by
      // their ids — the request's number and date are not the result's (the palette sends a year,
      // and no number for a code) — and only once the annex search has landed an article.
      const created = createdRowsRef.current;
      pendingStrayRef.current = created.search === params ? created.rows : [];
      createdRowsRef.current = { search: null, rows: [] };
    }
  });

  // Register search for auto-switch detection when search trigger is used. A search the user typed
  // (the palette, the field) runs as the palette always ran it, unchecked.
  useEffect(() => {
    if (searchTrigger && !searchTrigger.annex && !isTypedSearch(searchTrigger)) {
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
    // The text in force of an article of the same act already on the table is revealed,
    // not searched again (T2); a past text of it never stands in for it, so without its row the text
    // in force is loaded as a new row. A past text's jump asks for its own version, so it searches.
    // Cited from a light window (`askerId`), the row opens beside that window instead of being
    // revealed in the table (spec §4.5), and a search it needs starts from the window.
    if (!requestIsHistorical(normaData)) {
      const { practices, activePracticeId, revealPracticeRow } = appStore.getState();
      const askerPractice = askerPracticeOf(askerId);
      const practice = askerPractice ?? practices.find((p) => p.id === activePracticeId);
      const act = practice?.acts.find((a) => a.key === actKeyOf(normaData));
      const articleId = normaData.allegato ? `all${normaData.allegato}:${articleNumber}` : articleNumber;
      const inForce = act && findPracticeArticle(
        { ...act, articles: act.articles.filter((a) => !requestIsHistorical(a.norma_data)) }, articleId);
      if (practice && act && inForce) {
        if (askerPractice && askerId) {
          openFromAsker(practice.id, besideRefFor({ kind: 'article', actId: act.id, articleKey: practiceArticleKey(inForce) }), askerId);
          return;
        }
        if (revealPracticeRow(practice.id, act.id, practiceArticleKey(inForce))) return;
      }
    }
    handleSearch(askerId ? { ...params, besideId: askerId } : params);
  }, [handleSearch]);


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

  const hasTabs = practiceCount > 0;
  const practiceStreaming: PracticeStreaming | null = loadingProgress && streamingPracticeId
    ? { practiceId: streamingPracticeId, ...loadingProgress }
    : null;

  return (
    <>
      {/* One global control: the back-stack is global, so a per-practice copy would
          sit inside the very place an entry points at. */}
      <ReadingBackControl
        // It floats above the bar, clear of the act's heading and the windows' headers. Going back
        // already made the practice active and, on a phone, opened the reader on a subject read beside
        // or closed it for a row of the table (`walkBackTo`, in one update).
        bottomOffset={isDesktop ? (practiceBarHeight ?? BAR_MIN_HEIGHT) + BAR_OFFSET + 12 : PHONE_BACK_OFFSET}
      />

      {/* The table and the bar on the desktop, the phone's table below md; one layout mounted (T4,
          gotcha 26). */}
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

      {/* «Scrivania»: the page with no practice open (spec 2026-10-18-redesign-inchiostro §5.3.2). */}
      {!hasTabs && !isLoading && <Scrivania />}

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
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4 rounded-2xl shadow-lg flex items-start gap-4">
              {/* The book breathes while the texts arrive (spec 2026-10-18-redesign-inchiostro §6.3.1). */}
              <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center text-primary-600 dark:text-primary-400">
                <BookMark size={28} breathe />
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
                  Caricamento articoli…
                </h4>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed">
                  {loadingProgress.total
                    ? `${loadingProgress.loaded} di ${loadingProgress.total} articoli caricati`
                    : `${loadingProgress.loaded} articoli caricati`}
                </p>
                {/* Progress bar */}
                {loadingProgress.total && (
                  <div className="mt-2 h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full origin-left bg-primary-600 dark:bg-primary-400"
                      initial={{ transform: 'scaleX(0)' }}
                      animate={{ transform: `scaleX(${loadingProgress.loaded / loadingProgress.total})` }}
                      transition={{ duration: dur.panel, ease: ease.out }}
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
