import { useMemo, type ReactNode } from 'react';
import { useSimpleReading } from './simpleReading';
import { retryRowText, useRowText } from './useRowText';
import { RowTextStatus } from './RowTextStatus';
import { Star, Zap } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import type { ArticleData } from '../../../types';
import { ArticleTabContent } from '../search/ArticleTabContent';
import { articleLabel } from '../dossier/dossierLayout';
import { getRubricText, parseArticleStructure } from '../../../utils/articleStructure';
import { historicalItemLabel } from '../../../utils/versionDisplay';
import { shortNorm } from '../../../utils/sources';
import { NotInDossier, PracticeRowShell, type RowBeside } from './PracticeRowShell';
import { useArticleInDossier } from './inDossier';
import { articleRowKey, articleWindowId, besideRefFor, practiceArticleKey } from '../../../utils/practice';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { quickNormParamsOf } from '../../../utils/quickNormParams';
import { openPracticeWindow } from './practiceSwitch';

export interface PracticeArticleRowProps {
  practiceId: string;
  actId: string;
  article: ArticleData;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
  onOpenStudyMode: () => void;
  /** Drawn inside the open row, above the text: the annex suggestion that concerns this article. */
  annexSuggestion?: ReactNode;
}

/**
 * One article of its act on the practice's table (spec §3.2): «art. 2043 — rubrica», a past text's
 * «Testo al …», «Togli dal tavolo». Open, it reads the article in place on the reading
 * surface, untouched (root rule 23); closed, it mounts nothing. Whether it is open is the store's
 * (`practiceRows`, T15), so a reveal opens it from anywhere.
 */
export function PracticeArticleRow({
  practiceId, actId, article, onCrossReference, onOpenStudyMode, annexSuggestion,
}: PracticeArticleRowProps) {
  const { simple } = useSimpleReading();
  const articleKey = practiceArticleKey(article);
  const rowKey = articleRowKey(practiceId, actId, articleKey);
  const isOpen = useAppStore((s) => s.practiceRows[rowKey] === true);
  const textState = useRowText(practiceId, actId, article, simple || isOpen);
  // Among the quick norms (R3b): its toggle is an entry of the reader's «⋯», so the row says it, open or folded, by the
  // reader's own rule (`isQuickNorm`, so the two never disagree) — for the text in force only: a quick norm opens that one.
  const quickParams = useMemo(() => quickNormParamsOf(article.norma_data), [article.norma_data]);
  const isQuick = useAppStore((s) => s.quickNorms.length > 0 && !historicalItemLabel(article.norma_data) && s.isQuickNorm(quickParams));
  const setRowOpen = useAppStore((s) => s.setRowOpen);
  const removePracticeArticle = useAppStore((s) => s.removePracticeArticle);
  // In a dossier's «Lettura» (LC55): in the dossier or not; undefined in the Corpus.
  const dossier = useArticleInDossier(article.norma_data);
  // In the Corpus (LC59): «Aggiungi al dossier» through the reader's popover, and the dossiers that hold it.
  const corpusItem = useMemo(() => ({ norma: article.norma_data }), [article.norma_data]);
  const closeBeside = useAppStore((s) => s.closeBeside);
  const openPhoneReader = useAppStore((s) => s.openPhoneReader);
  const closePhoneReader = useAppStore((s) => s.closePhoneReader);
  const windowId = articleWindowId(actId, articleKey);
  const shownBeside = useAppStore((s) => s.practices.find((p) => p.id === practiceId)?.beside.some((b) => b.id === windowId) === true);
  // Windows exist on the desktop only: a phone reads beside in its full-screen reader and folds no row.
  const isDesktop = useIsDesktop();
  const beside = useMemo<RowBeside>(() => isDesktop ? {
    shown: shownBeside,
    // The overview gives way to the reading view, through the passage (L-62), this row with it: the window takes the focus.
    onOpen: () => openPracticeWindow(practiceId, besideRefFor({ kind: 'article', actId, articleKey })),
    onClose: () => closeBeside(practiceId, windowId),
  } : {
    shown: false,
    onOpen: () => openPhoneReader(practiceId, besideRefFor({ kind: 'article', actId, articleKey })),
    onClose: closePhoneReader,
  }, [isDesktop, shownBeside, closeBeside, openPhoneReader, closePhoneReader, practiceId, actId, articleKey, windowId]);

  const { norma_data: norma } = article;
  const text = article.article_text || '';
  // From the article's own text: no request (spec §3.2).
  const rubrica = useMemo(() => (text ? getRubricText(text, parseArticleStructure(text)) : null), [text]);
  // "Testo al 29/12/2007": what was asked for, beside the text, never in it (gotcha 32).
  const historicalLabel = historicalItemLabel(norma);
  // Where a jump out of this row walks back to: the practice, the act, and this row by its key, so
  // a past text comes back as itself (carry-over ruling 12).
  const readingOrigin = useMemo(
    () => ({ tabId: practiceId, blockId: actId, articleKey }),
    [practiceId, actId, articleKey],
  );

  // The accessible name replaces the header's content: it names the act, so two laws' art. 3 never
  // read alike, and the version, so two texts of one article neither.
  const named = shortNorm(norma)
    + (historicalLabel ? `, ${historicalLabel.charAt(0).toLowerCase()}${historicalLabel.slice(1)}` : '');

  // A bound row's text still coming, or failed (LC54): said in its place, never an empty reader.
  const reader = textState ? <RowTextStatus state={textState} onRetry={() => retryRowText(practiceId, actId, article)} /> : (
    <ArticleTabContent
      data={article}
      onCrossReferenceNavigate={onCrossReference}
      onOpenStudyMode={onOpenStudyMode}
      readingOrigin={readingOrigin}
      dossierItemId={dossier?.itemId}
    />
  );

  // Lettura semplice (LC28): the article alone, its own heading in the text («Art. 530 / Sentenza di assoluzione») the
  // only one; no row heading repeating it, no fold. The reading toolbar pins under the act's heading as in the table.
  if (simple) {
    return (
      <div className="pt-2" style={{ ['--reading-toolbar-top' as string]: 'var(--practice-head, 0px)' }}>
        {/* No row heading here: the mark and «Aggiungi al dossier» stand over the text; «Togli…» is the act's «⋯». */}
        {dossier && !dossier.inDossier && (
          <p className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <NotInDossier />
            {dossier.add && (
              <button
                type="button"
                onClick={dossier.add}
                className="inline-flex min-h-[44px] items-center rounded-md px-2 font-medium text-primary-700 hover:bg-primary-50 md:min-h-0 md:py-0.5 dark:text-primary-300 dark:hover:bg-primary-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                Aggiungi al dossier
              </button>
            )}
          </p>
        )}
        {/* No row «⋯» here: the star stands over the text with its name (LC58), as the act's commands do. */}
        {dossier?.inDossier && (
          <p className="mb-2 text-sm">
            <button
              type="button"
              aria-pressed={dossier.important}
              onClick={dossier.toggleImportant}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 font-medium text-slate-700 hover:bg-amber-50 md:min-h-0 md:py-0.5 dark:text-slate-200 dark:hover:bg-amber-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <Star size={14} aria-hidden className={dossier.important ? 'fill-amber-400 text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'} />
              {dossier.important ? 'Importante' : 'Segna come importante'}
            </button>
          </p>
        )}
        {annexSuggestion}
        {reader}
      </div>
    );
  }

  return (
    <PracticeRowShell
      rowKey={rowKey}
      isOpen={isOpen}
      onToggle={() => setRowOpen(rowKey, !isOpen)}
      // The toggle's name replaces the header's content (a button's children are not read): it carries the sign's words.
      name={isQuick ? `${named}, tra le norme rapide` : named}
      removeName={named}
      onRemove={() => removePracticeArticle(practiceId, actId, articleKey)}
      beside={beside}
      dossier={dossier}
      corpusItem={corpusItem}
      header={(
        <>
          <span className="min-w-0 flex-1 truncate text-sm md:text-[15px]">
            <span className="font-medium text-slate-900 dark:text-white">{articleLabel(norma)}</span>
            {rubrica && (
              <span className="text-slate-500 dark:text-slate-400">
                {' · '}
                <span>{rubrica}</span>
              </span>
            )}
          </span>
          {isQuick && (
            <span aria-hidden title="Tra le norme rapide" className="flex-shrink-0 text-amber-600 dark:text-amber-400">
              <Zap size={14} aria-hidden className="fill-current" />
            </span>
          )}
          {historicalLabel && (
            <span className="flex-shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              {historicalLabel}
            </span>
          )}
        </>
      )}
      // The reading toolbar pins under the act's heading, not over it (both are sticky).
      regionStyle={{ ['--reading-toolbar-top' as string]: 'var(--practice-head, 0px)' }}
    >
      {annexSuggestion}
      {reader}
    </PracticeRowShell>
  );
}
