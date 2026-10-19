import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useArticleMarkers } from '../../../hooks/useArticleMarkers';
import { useArticleTextInteractions } from '../../../hooks/useArticleTextInteractions';
import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { getUpdateNoteParagraphs, parseArticleStructure } from '../../../utils/articleStructure';
import { buildItemKey } from '../../../utils/normaKeys';
import { formatNormCitation, unversionedCitation, withCitation } from '../../../utils/citation';
import { todayInRome } from '../../../utils/dateUtils';
import { describeVersion } from '../../../utils/versionDisplay';
import type { ArticleData, NormaVisitata } from '../../../types';
import { ArticleBody } from '../search/ArticleBody';
import { UpdateNotePopover } from '../search/UpdateNotePopover';
import { VersionBanner } from '../search/VersionBanner';

export interface ArticleReadOnlyProps {
  norma: NormaVisitata;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type Settled = { key: string; article: ArticleData } | { key: string; message: string };

// A stable empty list, so the memoised rendering does not run again for a fresh one.
const NONE: never[] = [];

/**
 * An article read and nothing else: the text the dossier reader shows, without the reader's marks,
 * notes, highlights or discussions (a validator reads the law a card rests on; nothing here is
 * written to the validator's account). The selection offers «Copia» alone, with the citation the
 * reader copies with. The update notes still open, since the rule that applies is often in them.
 * Fetched through `articleFetchCache`, so an article seen twice is read once.
 */
export function ArticleReadOnly({ norma, showToast }: ArticleReadOnlyProps) {
  const [settled, setSettled] = useState<Settled | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const itemKey = useMemo(() => buildItemKey(norma), [norma]);

  // A result that does not match the request now in force is stale, and stale is the loading state.
  const requestKey = `${itemKey}#${retryTick}`;
  useEffect(() => {
    let cancelled = false;
    fetchArticleForNorma(norma)
      .then((article) => !cancelled && setSettled({ key: requestKey, article }))
      .catch((error: unknown) => !cancelled && setSettled({ key: requestKey, message: error instanceof Error ? error.message : 'Errore di caricamento' }));
    return () => {
      cancelled = true;
    };
  }, [norma, requestKey]);

  const current = settled?.key === requestKey ? settled : null;
  const article = current && 'article' in current ? current.article : undefined;
  const display = article ? describeVersion(article.validity, norma) : null;

  const rawText = article?.article_text || '';
  const structure = useMemo(() => parseArticleStructure(rawText), [rawText]);
  const html = useArticleMarkers({ rawText, highlights: NONE, annotations: NONE, structure, signs: false });
  const { updatesOpen, openNote, closeNote } = useArticleTextInteractions(contentRef, itemKey, {
    enabled: article !== undefined,
    contentKey: html,
    updatesOpenByDefault: display?.updateNotesOpen ?? false,
  });

  const copy = async (text: string) => {
    if (display && !display.canCopyOrSave) {
      showToast(display.copyBlockedReason ?? '', 'info');
      return;
    }
    const citation = display?.canCite
      ? formatNormCitation({ norma, validity: article?.validity, requestedDate: undefined, original: false, consultedAt: todayInRome() })
      : null;
    try {
      await navigator.clipboard.writeText(withCitation(text, citation, unversionedCitation(norma, todayInRome())));
      showToast('Testo copiato con citazione', 'success');
    } catch {
      showToast('Errore durante la copia', 'error');
    }
  };

  if (!current) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <RefreshCw size={14} aria-hidden className="animate-spin" /> Recupero del testo…
      </p>
    );
  }
  if (!article) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-600 dark:text-red-400">
        <span>{'message' in current ? current.message : ''}</span>
        <button
          type="button"
          onClick={() => setRetryTick((tick) => tick + 1)}
          className="min-h-[44px] rounded px-2 font-medium underline md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          Riprova
        </button>
      </div>
    );
  }

  return (
    <div>
      {display?.banner && <VersionBanner banner={display.banner} variant={display.textVisible ? 'banner' : 'state'} />}
      {(display?.textVisible ?? true) && (
        <ArticleBody
          contentRef={contentRef}
          itemKey={itemKey}
          processedContent={html}
          onPopupHighlight={() => {}}
          onPopupAddNote={() => {}}
          onPopupCopy={copy}
          updatesOpen={updatesOpen}
          copyOnly
        />
      )}
      {openNote && structure.notes[openNote.id] && (
        <UpdateNotePopover
          noteId={openNote.id}
          paragraphs={getUpdateNoteParagraphs(rawText, structure.notes[openNote.id])}
          anchorEl={openNote.anchorEl}
          onClose={closeNote}
        />
      )}
    </div>
  );
}
