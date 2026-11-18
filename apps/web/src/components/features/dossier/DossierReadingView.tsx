import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { appStore, useAppStore } from '../../../store/useAppStore';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import type { ArticleData, Dossier, Norma, NormaVisitata, SearchParams } from '../../../types';
import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { articleRowKey, besideRefFor, practiceArticleKey } from '../../../utils/practice';
import { scrollParentOf } from '../../../utils/scrollParent';
import { keepLastRead, lastReadOf } from './lastRead';
import { deriveVersionInfo } from '../../../utils/versionDisplay';
import { ReadingHostContext, type ReadingHost } from '../practice/readingHost';
import { askerPracticeOf, crossReferenceParams, fetchActPdfUrl, openFromAsker, revealHeldCitation } from '../practice/hostGestures';
import { ReadingRow } from '../practice/ReadingRow';
import { PracticePhoneView } from '../practice/PracticePhoneView';

const PDFViewer = lazy(() => import('../../ui/PDFViewer').then((m) => ({ default: m.PDFViewer })));

type ToastType = 'success' | 'error' | 'info';

/** The window of the dossier's table `besideId` names (a light window, the phone's reader), if it is one. */
function askerOn(practiceId: string, besideId: string | undefined): string | undefined {
  return besideId && askerPracticeOf(besideId)?.id === practiceId ? besideId : undefined;
}

/**
 * A search gesture of the reader (a norm of another act, «testo al…», «vai al vigente», a norm cited in a decision) puts
 * its article on the dossier's table, never in the dossier (§16, answer 2): fetched as Ricerca fetches it, so it joins
 * its act when the table holds it, and a past text is a row of its own; revealed, or opened beside the window it came
 * from. A failure leaves the row with its error, which says so and offers «Riprova».
 * shortcut: one article per gesture (the reader's gestures ask for one); a range would land its first only.
 */
async function putOnTable(practiceId: string, params: SearchParams): Promise<void> {
  const asked: NormaVisitata = {
    tipo_atto: params.act_type, numero_atto: params.act_number, data: params.date, numero_articolo: params.article,
    versione: params.version,
    ...(params.version_date ? { data_versione: params.version_date } : {}),
    ...(params.annex ? { allegato: params.annex } : {}),
  };
  let loaded: ArticleData;
  try {
    loaded = { ...(await fetchArticleForNorma(asked)), versionInfo: deriveVersionInfo(params) };
  } catch (e) {
    loaded = { norma_data: asked, error: e instanceof Error ? e.message : 'Testo non disponibile' };
  }
  const store = appStore.getState();
  // Its table gone meanwhile (a sign-out): nowhere to put it — never the Corpus's practice.
  if (!store.practices.some((p) => p.id === practiceId)) return;
  const n = loaded.norma_data;
  const act: Norma = { tipo_atto: n.tipo_atto, data: n.data, numero_atto: n.numero_atto, tipo_atto_reale: n.tipo_atto_reale, urn: n.url };
  const asker = askerOn(practiceId, params.besideId);
  const landed = store.addArticlesToPractice(practiceId, act, [loaded], asker ? {} : { reveal: 'first' });
  if (asker) openFromAsker(practiceId, besideRefFor({ kind: 'article', actId: landed.actId, articleKey: practiceArticleKey(loaded) }), asker);
}

/** How long the last article's place is asked for again while its text arrives. */
const SETTLE_MS = 4000;
/** What a user's own scroll starts with: it ends the asking. */
const USER_SCROLL = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/**
 * «Fonti» opens with its rows closed but the last article read (LC86, L-79), opened again where it was: once per table,
 * when the dossier's page opens it. Then it follows what is read: the row last opened, and how far into it the scroller
 * is, kept in this browser (`lastRead.ts`).
 */
function useLastRead(dossierId: string, practiceId: string | undefined, rootRef: RefObject<HTMLElement | null>) {
  const opened = useRef<string | null>(null);
  const toPlace = useRef<{ rowKey: string; offset: number } | null>(null);
  useEffect(() => {
    if (!practiceId) return undefined;
    if (opened.current !== practiceId) {
      // Once per table, StrictMode's second run included: a second run would close again the row the first one opened.
      opened.current = practiceId;
      const s = appStore.getState();
      const table = s.practices.find((p) => p.id === practiceId);
      Object.keys(s.practiceRows).filter((key) => key.startsWith(`${practiceId}/`)).forEach((key) => s.setRowOpen(key, false));
      const kept = lastReadOf(dossierId);
      const act = kept ? table?.acts.find((a) => a.key === kept.act) : undefined;
      if (kept && act && s.revealPracticeRow(practiceId, act.id, kept.article) && kept.offset > 0) {
        toPlace.current = { rowKey: articleRowKey(practiceId, act.id, kept.article), offset: kept.offset };
      }
    }
    const target = toPlace.current;
    if (!target) return undefined;
    // Where it was read: the row's top that far above the scroller's, asked again as the text comes and the row grows,
    // until the user scrolls or the time is out.
    let observer: ResizeObserver | null = null;
    const release = () => {
      observer?.disconnect();
      clearTimeout(timer);
      USER_SCROLL.forEach((type) => window.removeEventListener(type, done, true));
    };
    const done = () => {
      toPlace.current = null;
      release();
    };
    const place = () => {
      const row = rootRef.current?.querySelector<HTMLElement>(`[data-practice-row="${CSS.escape(target.rowKey)}"]`);
      const scroller = row ? scrollParentOf(row) : null;
      if (!row || !scroller) return;
      if (!observer && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(place);
        observer.observe(row);
      }
      if (row.offsetHeight <= target.offset) return;
      scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + target.offset;
    };
    const timer = setTimeout(done, SETTLE_MS);
    USER_SCROLL.forEach((type) => window.addEventListener(type, done, { capture: true, passive: true }));
    const frame = requestAnimationFrame(place);
    return () => {
      cancelAnimationFrame(frame);
      release();
    };
  }, [dossierId, practiceId, rootRef]);

  // What is read: the article row opened last, and how far into it the page is scrolled.
  useEffect(() => {
    if (!practiceId) return undefined;
    const prefix = `${practiceId}/`;
    let reading: { rowKey: string; act: string; article: string } | null = null;
    const follow = (rows: Record<string, true>, before?: Record<string, true>) => {
      const opened = Object.keys(rows).filter((key) => key.startsWith(prefix) && !before?.[key]);
      for (const rowKey of opened.reverse()) {
        const [, actId, ...rest] = rowKey.split('/');
        const article = rest.join('/');
        const act = appStore.getState().practices.find((p) => p.id === practiceId)?.acts.find((a) => a.id === actId);
        if (!act || !act.articles.some((a) => practiceArticleKey(a) === article)) continue;
        reading = { rowKey, act: act.key, article };
        keepLastRead(dossierId, { act: act.key, article, offset: 0 });
        return;
      }
    };
    // The row the opening revealed is the one read until another opens.
    follow(appStore.getState().practiceRows);
    const unsubscribe = appStore.subscribe((state, prev) => {
      if (state.practiceRows !== prev.practiceRows) follow(state.practiceRows, prev.practiceRows);
    });
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const row = reading && appStore.getState().practiceRows[reading.rowKey]
          ? rootRef.current?.querySelector<HTMLElement>(`[data-practice-row="${CSS.escape(reading.rowKey)}"]`)
          : null;
        const scroller = row ? scrollParentOf(row) : null;
        // «Fonti» hidden under another tab draws no row: a scroll there says nothing of the reading.
        if (!row || !scroller || !reading || row.getClientRects().length === 0) return;
        const offset = Math.round(Math.max(0, scroller.getBoundingClientRect().top - row.getBoundingClientRect().top));
        keepLastRead(dossierId, { act: reading.act, article: reading.article, offset: Math.min(offset, row.offsetHeight) });
      });
    };
    // The page's scroller is where the reading moves; captured, so a column that scrolls on its own counts too.
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [dossierId, practiceId, rootRef]);
}

interface Props {
  dossier: Dossier;
  showToast: (message: string, type?: ToastType) => void;
  /** The page's trash, read again after «Togli dal dossier» (as «Fonti» does). */
  onTrashChanged?: () => void;
}

/**
 * The dossier's «Lettura» (LC54 c3): the Corpus's reading — the table with its windows on a computer, the column and the
 * full-screen reader on a phone — on the dossier's own bound table (`openDossierPractice`, session only, never the
 * Corpus's active practice). Built when the tab opens, re-synced each time the page's dossier changes (`refreshDossier`,
 * an item added here or by Claude). The page hosts the reading: its search gestures, its PDF and a norm of the same act
 * stay here. Reading writes nothing into the dossier: only «Aggiungi al dossier», «Togli dal dossier» and the acts' order
 * do (LC55 c4, the host's `dossier`; each row says whether it is in it, `practice/inDossier.ts`).
 */
export function DossierReadingView({ dossier, showToast, onTrashChanged }: Props) {
  const isDesktop = useIsDesktop();
  const practiceId = useAppStore((s) => s.practices.find((p) => p.dossierId === dossier.id)?.id);
  const empty = useAppStore((s) => {
    const table = s.practices.find((p) => p.dossierId === dossier.id);
    return table !== undefined && table.acts.length === 0 && table.decisions.length === 0;
  });
  // Builds the table, or re-syncs the one already open (`openDossierPractice` calls `resyncDossierPractice` then).
  useEffect(() => { appStore.getState().openDossierPractice(dossier); }, [dossier]);
  const rootRef = useRef<HTMLDivElement>(null);
  useLastRead(dossier.id, practiceId, rootRef);

  // The tests of 16-11: an item removed in another window kept its row unmarked until the page's poll (its focus read
  // waits 15 s). Here the dossier is read on opening the tab and every time the window comes back, with no wait; the
  // focus and the visibility of one return are one read.
  useEffect(() => {
    let last = 0;
    const read = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 1000) return;
      last = Date.now();
      void appStore.getState().refreshDossier(dossier.id, { quiet: true });
    };
    read();
    window.addEventListener('focus', read);
    document.addEventListener('visibilitychange', read);
    return () => {
      window.removeEventListener('focus', read);
      document.removeEventListener('visibilitychange', read);
    };
  }, [dossier.id]);

  const trashChanged = useRef(onTrashChanged);
  useEffect(() => { trashChanged.current = onTrashChanged; }, [onTrashChanged]);
  const toast = useRef(showToast);
  useEffect(() => { toast.current = showToast; }, [showToast]);

  const [pending, setPending] = useState(0);
  const host = useMemo<ReadingHost>(() => ({
    search: (params) => {
      if (!practiceId) return;
      setPending((n) => n + 1);
      void putOnTable(practiceId, params).finally(() => setPending((n) => n - 1));
    },
    // Through a ref: the page's callback is new at each render, and a new host would redraw the whole reading.
    dossier: { id: dossier.id, onTrashChanged: () => trashChanged.current?.(), showToast: (message, type) => toast.current(message, type) },
  }), [practiceId, dossier.id]);

  const onCrossReference = useCallback((articleNumber: string, normaData: ArticleData['norma_data'], askerId?: string) => {
    const table = appStore.getState().practices.find((p) => p.id === practiceId);
    const asker = table ? askerOn(table.id, askerId) : undefined;
    if (table && revealHeldCitation(table, articleNumber, normaData, asker)) return;
    const params = crossReferenceParams(articleNumber, normaData);
    host.search(asker ? { ...params, besideId: asker } : params);
  }, [practiceId, host]);

  const [pdf, setPdf] = useState<{ url: string | null; isLoading: boolean } | null>(null);
  const onViewPdf = useCallback(async (urn: string) => {
    setPdf({ url: null, isLoading: true });
    try {
      setPdf({ url: await fetchActPdfUrl(urn), isLoading: false });
    } catch (e) {
      console.error(e);
      setPdf(null);
      showToast('Impossibile caricare il PDF.', 'error');
    }
  }, [showToast]);

  return (
    <div ref={rootRef} className="space-y-3">
      {/* §14: nothing goes away without saying so. What a gesture puts on the table is not the dossier's (c4 adds it). */}
      <p className="text-sm text-slate-600 dark:text-slate-400">Quello che apri leggendo resta qui finché non lo aggiungi alla pratica.</p>
      {pending > 0 && <p role="status" className="text-sm text-slate-600 dark:text-slate-400">Carico il testo…</p>}
      {practiceId && (empty ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-12 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
          Questa pratica non ha ancora norme o sentenze da leggere.
        </p>
      ) : (
        <ReadingHostContext.Provider value={host}>
          {isDesktop ? (
            <ReadingRow practiceId={practiceId} onViewPdf={onViewPdf} onCrossReference={onCrossReference} streaming={null} />
          ) : (
            <PracticePhoneView practiceId={practiceId} onViewPdf={onViewPdf} onCrossReference={onCrossReference} streaming={null} />
          )}
        </ReadingHostContext.Provider>
      ))}
      {pdf && (
        <Suspense fallback={null}>
          <PDFViewer isOpen onClose={() => setPdf(null)} pdfUrl={pdf.url} isLoading={pdf.isLoading} />
        </Suspense>
      )}
    </div>
  );
}
