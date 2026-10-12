import { useCallback, useEffect, useMemo, useRef, type ComponentProps } from 'react';
import { X } from 'lucide-react';
import { FOCUS_RING } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import type { ArticleData } from '../../../types';
import type { BesideRef } from '../../../utils/practice';
import { ArticleTabContent } from '../search/ArticleTabContent';
import { DecisionEntryView } from '../decisions/DecisionEntryView';
import { DecisionSearchTabView } from '../decisions/DecisionSearchTabView';
import { subjectOf, titleOf, type Subject } from './practiceView';

/** The bar of practices floats over the results area (`fixed bottom-6`): a window's scrolling body
 *  keeps the same bottom padding as the column (spec §3.4). */
const BODY_PADDING_BOTTOM = 'pb-[calc(var(--practice-bar-height,3.75rem)+2.25rem)]';

/** A norm cited in a window's text: `askerId` is the window, which the cited article opens beside. */
type OnCrossReference = (articleNumber: string, normaData: ArticleData['norma_data'], askerId?: string) => void;

export interface ReadingWindowProps {
  /** The practice the window belongs to: it finds the subject there and, as `findHostId`, is the
   *  id the find window knows the window's text by (spec §6.6). */
  practiceId: string;
  besideRef: BesideRef;
  onCrossReference: OnCrossReference;
  /** The window ends at the page's right edge, under Layout's full-screen toggle: its header leaves
   *  that corner free, so the × is never under or touching it. */
  clearTopRight?: boolean;
}

/**
 * A light window beside the practice's table (spec §4.1): a header with the title and «Chiudi», a
 * scrolling body, and the body of its kind. Closing it leaves the subject in the table (D7). It
 * fills the column its row gives it.
 */
export function ReadingWindow({ practiceId, besideRef, onCrossReference, clearTopRight = false }: ReadingWindowProps) {
  const practice = useAppStore((s) => s.practices.find((p) => p.id === practiceId));
  const closeBeside = useAppStore((s) => s.closeBeside);
  const subject = subjectOf(practice, besideRef);
  const title = titleOf(subject);

  // Asked for again (a link, the way back), the window takes focus: one request, taken atomically
  // (gotcha 14), so a second invocation finds nothing.
  const sectionRef = useRef<HTMLElement>(null);
  const focusRequested = useAppStore((s) => s.windowFocusRequest === besideRef.id);
  const takeFocusRequest = useAppStore((s) => s.takeWindowFocusRequest);
  useEffect(() => {
    if (focusRequested && takeFocusRequest(besideRef.id)) sectionRef.current?.focus({ preventScroll: true }); // the window is already on screen: the page stays where it is
  }, [focusRequested, takeFocusRequest, besideRef.id]);

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label={title}
      data-testid="reading-window"
      data-window-id={besideRef.id}
      className="flex h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
    >
      <header
        data-reading-window-header
        className={cn(
          'flex min-h-[44px] flex-shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-1 dark:border-slate-700',
          clearTopRight && 'md:pr-12',
        )}
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

interface ReadingWindowBodyProps extends Omit<ReadingWindowProps, 'clearTopRight'> {
  subject: Subject | null;
}

// The body by kind. A window reads under its own id (its way back, its focus); the find window
// knows its text by its practice (`findHostId`), so «Questa pratica» searches it. The phone's
// full-screen reader draws the same body (`ReadingFullScreen`).
export function ReadingWindowBody({ practiceId, besideRef, subject, onCrossReference }: ReadingWindowBodyProps) {
  const articleKey = besideRef.kind === 'article' ? besideRef.articleKey : '';
  const actId = subject?.kind === 'article' ? subject.actId : '';
  const readingOrigin = useMemo(
    () => ({ tabId: besideRef.id, blockId: actId, articleKey }),
    [besideRef.id, actId, articleKey],
  );

  // A norm cited in this window's text opens beside it: the window asks.
  const onCited = useCallback<NonNullable<ComponentProps<typeof ArticleTabContent>['onCrossReferenceNavigate']>>(
    (articleNumber, normaData) => onCrossReference(articleNumber, normaData, besideRef.id),
    [onCrossReference, besideRef.id],
  );

  if (!subject) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Questo testo non è più sul tavolo della pratica.</p>;
  }
  if (subject.kind === 'article') {
    return (
      <ArticleTabContent
        data={subject.article}
        onCrossReferenceNavigate={onCited}
        readingOrigin={readingOrigin}
        findHostId={practiceId}
        variant="beside"
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
