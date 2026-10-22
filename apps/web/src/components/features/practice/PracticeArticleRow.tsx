import { useMemo, type ReactNode } from 'react';
import { Zap } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import type { ArticleData } from '../../../types';
import { ArticleTabContent } from '../search/ArticleTabContent';
import { articleLabel } from '../dossier/dossierLayout';
import { getRubricText, parseArticleStructure } from '../../../utils/articleStructure';
import { historicalItemLabel } from '../../../utils/versionDisplay';
import { shortNorm } from '../../../utils/sources';
import { PracticeRowShell, type RowBeside } from './PracticeRowShell';
import { articleRowKey, articleWindowId, besideRefFor, practiceArticleKey } from '../../../utils/practice';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { quickNormParamsOf } from '../../../utils/quickNormParams';

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
  const articleKey = practiceArticleKey(article);
  const rowKey = articleRowKey(practiceId, actId, articleKey);
  const isOpen = useAppStore((s) => s.practiceRows[rowKey] === true);
  // Among the quick norms (R3b): its toggle is an entry of the reader's «⋯», so the row says it, open or folded, by the
  // reader's own rule (`isQuickNorm`, so the two never disagree) — for the text in force only: a quick norm opens that one.
  const quickParams = useMemo(() => quickNormParamsOf(article.norma_data), [article.norma_data]);
  const isQuick = useAppStore((s) => s.quickNorms.length > 0 && !historicalItemLabel(article.norma_data) && s.isQuickNorm(quickParams));
  const setRowOpen = useAppStore((s) => s.setRowOpen);
  const removePracticeArticle = useAppStore((s) => s.removePracticeArticle);
  const openBeside = useAppStore((s) => s.openBeside);
  const closeBeside = useAppStore((s) => s.closeBeside);
  const openPhoneReader = useAppStore((s) => s.openPhoneReader);
  const closePhoneReader = useAppStore((s) => s.closePhoneReader);
  const windowId = articleWindowId(actId, articleKey);
  const shownBeside = useAppStore((s) => s.practices.find((p) => p.id === practiceId)?.beside.some((b) => b.id === windowId) === true);
  // Windows exist on the desktop only: a phone reads beside in its full-screen reader and folds no row.
  const isDesktop = useIsDesktop();
  const beside = useMemo<RowBeside>(() => isDesktop ? {
    shown: shownBeside,
    onOpen: () => openBeside(practiceId, besideRefFor({ kind: 'article', actId, articleKey })),
    onClose: () => closeBeside(practiceId, windowId),
  } : {
    shown: false,
    onOpen: () => openPhoneReader(practiceId, besideRefFor({ kind: 'article', actId, articleKey })),
    onClose: closePhoneReader,
  }, [isDesktop, shownBeside, openBeside, closeBeside, openPhoneReader, closePhoneReader, practiceId, actId, articleKey, windowId]);

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
      header={(
        <>
          <span className="min-w-0 flex-1 truncate text-sm md:text-[15px]">
            <span className="font-medium text-slate-900 dark:text-white">{articleLabel(norma)}</span>
            {rubrica && (
              <span className="text-slate-500 dark:text-slate-400">
                {' — '}
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
      <ArticleTabContent
        data={article}
        onCrossReferenceNavigate={onCrossReference}
        onOpenStudyMode={onOpenStudyMode}
        readingOrigin={readingOrigin}
      />
    </PracticeRowShell>
  );
}
