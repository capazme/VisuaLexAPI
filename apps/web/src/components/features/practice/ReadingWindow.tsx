import { useMemo } from 'react';
import { X } from 'lucide-react';
import { FOCUS_RING } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import type { ArticleData } from '../../../types';
import type { DecisionReference, DecisionSearchQuery } from '../../../types/decisions';
import { practiceArticleKey, type BesideRef, type Practice } from '../../../utils/practice';
import { citeNorm } from '../../../utils/sources';
import { versionTabSuffix } from '../../../utils/versionDisplay';
import { ArticleTabContent } from '../search/ArticleTabContent';
import { DecisionEntryView } from '../decisions/DecisionEntryView';
import { DecisionSearchTabView } from '../decisions/DecisionSearchTabView';

/** The bar of practices floats over the results area (`fixed bottom-6`): a window's scrolling body
 *  keeps the same bottom padding as the column (spec §3.4). */
const BODY_PADDING_BOTTOM = 'pb-[calc(var(--practice-bar-height,3.75rem)+2.25rem)]';

type OnCrossReference = (articleNumber: string, normaData: ArticleData['norma_data']) => void;

/** What a window shows, found again in its practice: an article of an act, a decision entry, or a
 *  topic search (which holds its own query). Null when the practice no longer holds the subject. */
type Subject =
  | { kind: 'article'; actId: string; article: ArticleData }
  | { kind: 'decision'; decisionId: string; reference: DecisionReference; label: string }
  | { kind: 'decision-search'; query: DecisionSearchQuery; label: string };

function subjectOf(practice: Practice | undefined, ref: BesideRef): Subject | null {
  if (ref.kind === 'decision-search') return { kind: 'decision-search', query: ref.query, label: ref.label };
  if (!practice) return null;
  if (ref.kind === 'decision') {
    const entry = practice.decisions.find((d) => d.id === ref.decisionId);
    return entry ? { kind: 'decision', decisionId: entry.id, reference: entry.reference, label: entry.label } : null;
  }
  const article = practice.acts.find((a) => a.id === ref.actId)?.articles.find((a) => practiceArticleKey(a) === ref.articleKey);
  return article ? { kind: 'article', actId: ref.actId, article } : null;
}

/** The window's title: an article's citation (and the text it asks for, if past), a decision's
 *  label, a topic search's label (spec §4.1). */
function titleOf(subject: Subject | null): string {
  if (!subject) return 'Testo non più sul tavolo';
  if (subject.kind !== 'article') return subject.label;
  const { norma_data } = subject.article;
  return `${citeNorm(norma_data)}${versionTabSuffix({ version: norma_data.versione, versionDate: norma_data.data_versione })}`;
}

export interface ReadingWindowProps {
  /** The practice the window belongs to: it finds the subject there and, as `findHostId`, is the
   *  id the find window knows the window's text by (spec §6.6). */
  practiceId: string;
  besideRef: BesideRef;
  onCrossReference: OnCrossReference;
}

/**
 * A light window beside the practice's table (spec §4.1): a header with the title and «Chiudi», a
 * scrolling body, and the body of its kind. Closing it leaves the subject in the table (D7). It
 * fills the column its row gives it.
 */
export function ReadingWindow({ practiceId, besideRef, onCrossReference }: ReadingWindowProps) {
  const practice = useAppStore((s) => s.practices.find((p) => p.id === practiceId));
  const closeBeside = useAppStore((s) => s.closeBeside);
  const subject = subjectOf(practice, besideRef);
  const title = titleOf(subject);

  return (
    <section
      aria-label={title}
      data-testid="reading-window"
      data-window-id={besideRef.id}
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
    >
      <header
        data-reading-window-header
        className="flex min-h-[44px] flex-shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-1 dark:border-slate-700"
      >
        <h3 title={title} className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-white">
          {title}
        </h3>
        <button
          type="button"
          onClick={() => closeBeside(practiceId, besideRef.id)}
          aria-label={`Chiudi la finestra ${title}`}
          title="Chiudi la finestra"
          className={cn(
            'flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 md:min-h-0 md:min-w-0 md:p-2 dark:text-slate-300 dark:hover:bg-slate-700',
            FOCUS_RING,
          )}
        >
          <X size={16} aria-hidden />
        </button>
      </header>
      <div data-reading-window-body className={cn('min-h-0 flex-1 overflow-y-auto px-3 pt-3', BODY_PADDING_BOTTOM)}>
        <ReadingWindowBody practiceId={practiceId} besideRef={besideRef} subject={subject} onCrossReference={onCrossReference} />
      </div>
    </section>
  );
}

interface ReadingWindowBodyProps extends ReadingWindowProps {
  subject: Subject | null;
}

// The body by kind. A window reads under its own id (its way back, its focus); the find window
// knows its text by its practice (`findHostId`), so «Questa pratica» searches it.
function ReadingWindowBody({ practiceId, besideRef, subject, onCrossReference }: ReadingWindowBodyProps) {
  const articleKey = besideRef.kind === 'article' ? besideRef.articleKey : '';
  const actId = subject?.kind === 'article' ? subject.actId : '';
  const readingOrigin = useMemo(
    () => ({ tabId: besideRef.id, blockId: actId, articleKey }),
    [besideRef.id, actId, articleKey],
  );

  if (!subject) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Questo testo non è più sul tavolo della pratica.</p>;
  }
  if (subject.kind === 'article') {
    return (
      <ArticleTabContent
        data={subject.article}
        onCrossReferenceNavigate={onCrossReference}
        readingOrigin={readingOrigin}
        findHostId={practiceId}
      />
    );
  }
  if (subject.kind === 'decision') {
    return (
      <DecisionEntryView
        practiceId={practiceId}
        decisionId={subject.decisionId}
        reference={subject.reference}
        hostId={besideRef.id}
        findHostId={practiceId}
      />
    );
  }
  return <DecisionSearchTabView tabId={besideRef.id} query={subject.query} />;
}
