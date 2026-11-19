import { ChevronLeft } from 'lucide-react';
import { Button } from '../../ui/Button';
import { useAppStore } from '../../../store/useAppStore';
import type { ArticleData } from '../../../types';
import { ReadingWindowBody } from './ReadingWindow';
import { subjectOf, titleOf } from './practiceView';

export interface ReadingFullScreenProps {
  /** A norm cited in the reader's text: `askerId` is the reader's subject id, as a window's. */
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data'], askerId?: string) => void;
  /** Only the reader of this practice is drawn (LC52 c2); without it, whichever practice the reader names. */
  practiceId?: string;
}

/**
 * The phone's full-screen reader (spec §8, T19): what `phoneReader` names — an article, a decision or
 * a topic search of a practice — over the whole content area, with «‹ Pratica» (44 px) to return to
 * the table. The body is the light window's (`ReadingWindowBody`), so the reading, the compact
 * toolbar and the find window's registration are the window's own. It sits under the search page's
 * field, the phone's bar with the menu button beside it; the column is not mounted under it (gotcha 26),
 * so one subject has one reading surface.
 */
export function ReadingFullScreen({ onCrossReference, practiceId }: ReadingFullScreenProps) {
  const reader = useAppStore((s) => (practiceId === undefined || s.phoneReader?.practiceId === practiceId ? s.phoneReader : null));
  const practice = useAppStore((s) => s.practices.find((p) => p.id === s.phoneReader?.practiceId));
  const closePhoneReader = useAppStore((s) => s.closePhoneReader);
  if (!reader) return null;

  const subject = subjectOf(practice, reader.ref);
  // A topic search draws its own heading («Tema: …»): the header says what it is, once.
  const title = subject?.kind === 'decision-search' ? 'Ricerca per tema' : titleOf(subject);

  return (
    <section
      aria-label={title}
      data-testid="reading-full-screen"
      data-window-id={reader.ref.id}
      className="flex h-app-row min-w-0 flex-col overflow-hidden rounded-[8px] border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
    >
      <header className="flex min-h-[44px] flex-shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-1 dark:border-slate-700">
        <Button type="button" variant="quiet" size="lg" onClick={closePhoneReader} icon={<ChevronLeft size={18} aria-hidden />} className="shrink-0 gap-1 pl-0 pr-2">
          Pratica
        </Button>
        <h3 title={title} className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-white">
          {title}
        </h3>
      </header>
      {/* The back control and the feedback button float over the bottom edge: the body keeps clear of them. */}
      <div data-reading-window-body className="min-h-0 flex-1 overflow-y-auto px-3 pb-28 pt-3">
        <ReadingWindowBody practiceId={reader.practiceId} besideRef={reader.ref} subject={subject} onCrossReference={onCrossReference} />
      </div>
    </section>
  );
}
