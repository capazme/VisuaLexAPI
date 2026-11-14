import { useMemo, type ReactNode } from 'react';
import { PanelRightOpen, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import type { ArticleData } from '../../../types';
import { getRubricText, parseArticleStructure } from '../../../utils/articleStructure';
import { formatDecisionDeposit } from '../../../utils/decisionLinks';
import { articleWindowId, besideRefFor, decisionWindowId, practiceArticleKey, type PracticeDecision } from '../../../utils/practice';
import { shortNorm } from '../../../utils/sources';
import { historicalItemLabel } from '../../../utils/versionDisplay';
import { articleLabel } from '../dossier/dossierLayout';

/** The entry's «Togli dal tavolo»: shown on hover and focus, as a row's (`PracticeRowShell`). */
const REMOVE_BUTTON =
  'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-slate-400 opacity-0 transition-colors hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-900/20';

interface IndexEntryProps {
  /** A window shows the subject: the entry is marked, and a press takes the focus to that window. */
  shown: boolean;
  onOpen: () => void;
  /** The visible words: the entry's accessible name starts with what a press does, then says these. */
  label: ReactNode;
  /** The whole label, for the tooltip of a line the index's width cuts. */
  title: string;
  /** After «Togli dal tavolo», in the remove button's name. */
  removeName: string;
  onRemove: () => void;
}

/**
 * One line of the reading view's index (U2 «Lettura»): a press opens the subject beside, with the focus (an entry whose
 * window is open takes the focus there). The entries shown beside are marked with the window's sign and, for a screen
 * reader, in words («Vai alla finestra: …, aperto accanto») — never by colour alone; not `aria-current`, which would say
 * it twice and call two entries «current» with two windows open.
 */
function IndexEntry({ shown, onOpen, label, title, removeName, onRemove }: IndexEntryProps) {
  return (
    <li className="group flex items-center gap-1">
      <button
        type="button"
        onClick={onOpen}
        title={title}
        className={cn(
          'flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
          shown
            ? 'bg-slate-200/70 text-slate-900 dark:bg-slate-800 dark:text-white'
            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60',
        )}
      >
        <span className="sr-only">{shown ? 'Vai alla finestra: ' : 'Apri accanto: '}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {shown && (
          <>
            <PanelRightOpen size={14} aria-hidden className="flex-shrink-0 text-slate-500 dark:text-slate-400" />
            <span className="sr-only">, aperto accanto</span>
          </>
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Togli dal tavolo ${removeName}`}
        title="Togli dal tavolo"
        className={REMOVE_BUTTON}
      >
        <X size={14} aria-hidden />
      </button>
    </li>
  );
}

/** An article of an act in the index: «art. 2043 — rubrica», a past text's «testo al …». */
export function PracticeArticleEntry({ practiceId, actId, article }: { practiceId: string; actId: string; article: ArticleData }) {
  const articleKey = practiceArticleKey(article);
  const windowId = articleWindowId(actId, articleKey);
  const shown = useAppStore((s) => s.practices.find((p) => p.id === practiceId)?.beside.some((b) => b.id === windowId) === true);
  const openBeside = useAppStore((s) => s.openBeside);
  const removePracticeArticle = useAppStore((s) => s.removePracticeArticle);
  const text = article.article_text || '';
  // From the article's own text, as its row: no request.
  const rubrica = useMemo(() => (text ? getRubricText(text, parseArticleStructure(text)) : null), [text]);
  const { norma_data: norma } = article;
  const past = historicalItemLabel(norma);
  const pastWords = past ? `${past.charAt(0).toLowerCase()}${past.slice(1)}` : null;
  const number = articleLabel(norma) + (pastWords ? ` · ${pastWords}` : '');
  return (
    <IndexEntry
      shown={shown}
      onOpen={() => openBeside(practiceId, besideRefFor({ kind: 'article', actId, articleKey }), undefined, { focus: true })}
      label={(
        <>
          <span className="font-medium">{number}</span>
          {/* 600, not 500: 4.5:1 on the marked entry's ground too. */}
          {rubrica && <span className="text-slate-600 dark:text-slate-400">{' — '}{rubrica}</span>}
        </>
      )}
      title={rubrica ? `${number} — ${rubrica}` : number}
      removeName={shortNorm(norma) + (pastWords ? `, ${pastWords}` : '')}
      onRemove={() => removePracticeArticle(practiceId, actId, articleKey)}
    />
  );
}

/** A decision of «Giurisprudenza» in the index: its citation; the deposit in the tooltip. */
export function PracticeDecisionEntry({ practiceId, entry }: { practiceId: string; entry: PracticeDecision }) {
  const windowId = decisionWindowId(entry.id);
  const shown = useAppStore((s) => s.practices.find((p) => p.id === practiceId)?.beside.some((b) => b.id === windowId) === true);
  const openBeside = useAppStore((s) => s.openBeside);
  const removePracticeDecision = useAppStore((s) => s.removePracticeDecision);
  const deposit = formatDecisionDeposit({ tipo: entry.tipo, data_deposito: entry.depositDate });
  return (
    <IndexEntry
      shown={shown}
      onOpen={() => openBeside(practiceId, besideRefFor({ kind: 'decision', decisionId: entry.id }), undefined, { focus: true })}
      label={<span className="font-medium">{entry.label}</span>}
      title={entry.label + (deposit ? ` · ${deposit}` : '')}
      removeName={entry.label}
      onRemove={() => removePracticeDecision(practiceId, entry.id)}
    />
  );
}
