import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { appStore, useAppStore } from '../../../store/useAppStore';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import type { ArticleData, Dossier, Norma, NormaVisitata, SearchParams } from '../../../types';
import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { besideRefFor, practiceArticleKey } from '../../../utils/practice';
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

interface Props {
  dossier: Dossier;
  showToast: (message: string, type?: ToastType) => void;
}

/**
 * The dossier's «Lettura» (LC54 c3): the Corpus's reading — the table with its windows on a computer, the column and the
 * full-screen reader on a phone — on the dossier's own bound table (`openDossierPractice`, session only, never the
 * Corpus's active practice). Built when the tab opens, re-synced each time the page's dossier changes (`refreshDossier`,
 * an item added here or by Claude). The page hosts the reading: its search gestures, its PDF and a norm of the same act
 * stay here. Nothing it does writes into the dossier.
 */
export function DossierReadingView({ dossier, showToast }: Props) {
  const isDesktop = useIsDesktop();
  const practiceId = useAppStore((s) => s.practices.find((p) => p.dossierId === dossier.id)?.id);
  const empty = useAppStore((s) => {
    const table = s.practices.find((p) => p.dossierId === dossier.id);
    return table !== undefined && table.acts.length === 0 && table.decisions.length === 0;
  });
  // Builds the table, or re-syncs the one already open (`openDossierPractice` calls `resyncDossierPractice` then).
  useEffect(() => { appStore.getState().openDossierPractice(dossier); }, [dossier]);

  const [pending, setPending] = useState(0);
  const host = useMemo<ReadingHost>(() => ({
    search: (params) => {
      if (!practiceId) return;
      setPending((n) => n + 1);
      void putOnTable(practiceId, params).finally(() => setPending((n) => n - 1));
    },
  }), [practiceId]);

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
    <div className="space-y-3">
      {/* §14: nothing goes away without saying so. What a gesture puts on the table is not the dossier's (c4 adds it). */}
      <p className="text-sm text-slate-600 dark:text-slate-400">Quello che apri leggendo resta qui finché non lo aggiungi al dossier.</p>
      {pending > 0 && <p role="status" className="text-sm text-slate-600 dark:text-slate-400">Carico il testo…</p>}
      {practiceId && (empty ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-12 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
          Questo dossier non ha ancora norme o sentenze da leggere.
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
