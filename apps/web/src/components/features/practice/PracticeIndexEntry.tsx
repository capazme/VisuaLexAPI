import { useMemo, type ReactNode } from 'react';
import { MoreHorizontal, PanelRightOpen, X } from 'lucide-react';
import { MenuButton } from '../../ui/MenuButton';
import { IconButton } from '../../ui/IconButton';
import { buttonClassName } from '../../ui/buttonStyles';
import { rowDossierItems, useArticleInDossier, useDecisionInDossier, type RowDossier } from './inDossier';
import { NotInDossier } from './PracticeRowShell';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import type { ArticleData } from '../../../types';
import { getRubricText, parseArticleStructure } from '../../../utils/articleStructure';
import { formatDecisionDeposit } from '../../../utils/decisionLinks';
import { articleWindowId, besideRefFor, decisionWindowId, practiceArticleKey, type PracticeDecision } from '../../../utils/practice';
import { shortNorm } from '../../../utils/sources';
import { historicalItemLabel } from '../../../utils/versionDisplay';
import { articleLabel } from '../dossier/dossierLayout';

/** The entry's «Azioni»: `IconButton`'s square, 36 px on a computer, 44 on a phone. */
const ENTRY_MENU = cn(buttonClassName('quiet'), 'min-w-11 shrink-0 px-0 md:min-w-9');

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
  /** In a dossier's «Lettura» (LC55): the mark, and the commands in a «⋯» with their names. */
  dossier?: RowDossier;
}

/**
 * One line of the reading view's index (U2 «Lettura»): a press opens the subject beside, with the focus (an entry whose
 * window is open takes the focus there). The entries shown beside are marked with the window's sign and, for a screen
 * reader, in words («Vai alla finestra: …, aperto accanto») — never by colour alone; not `aria-current`, which would say
 * it twice and call two entries «current» with two windows open.
 */
function IndexEntry({ shown, onOpen, label, title, removeName, onRemove, dossier }: IndexEntryProps) {
  const outside = dossier !== undefined && !dossier.inDossier;
  return (
    <li className="group flex items-center gap-1">
      {/* bare-button: an entry of the index that is a whole option, its label and its window's sign. */}
      <button
        type="button"
        onClick={onOpen}
        title={title}
        className={cn(
          'flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors focus-visible:outline-none ',
          shown
            ? 'bg-slate-200/70 text-slate-900 dark:bg-slate-800 dark:text-white'
            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60',
        )}
      >
        <span className="sr-only">{shown ? 'Vai alla finestra: ' : 'Apri accanto: '}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {outside && (
          <>
            <span className="sr-only">, </span>
            <NotInDossier />
          </>
        )}
        {shown && (
          <>
            <PanelRightOpen size={14} aria-hidden className="flex-shrink-0 text-slate-500 dark:text-slate-400" />
            <span className="sr-only">, aperto accanto</span>
          </>
        )}
      </button>
      {dossier ? (
        <MenuButton label={`Azioni su ${removeName}`} triggerClassName={ENTRY_MENU} items={rowDossierItems(dossier, onRemove)}>
          <MoreHorizontal size={14} aria-hidden />
        </MenuButton>
      ) : (
        // Shown on hover and focus, as a row's (`PracticeRowShell`).
        <IconButton
          onClick={onRemove}
          aria-label={`Togli dal tavolo ${removeName}`}
          title="Togli dal tavolo"
          icon={<X aria-hidden />}
          className="shrink-0 text-slate-400 opacity-0 hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 focus-visible:opacity-100 dark:hover:bg-red-900/20"
        />
      )}
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
  const dossier = useArticleInDossier(article.norma_data);
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
          {rubrica && <span className="text-slate-600 dark:text-slate-400">{' · '}{rubrica}</span>}
        </>
      )}
      title={rubrica ? `${number} · ${rubrica}` : number}
      removeName={shortNorm(norma) + (pastWords ? `, ${pastWords}` : '')}
      onRemove={() => removePracticeArticle(practiceId, actId, articleKey)}
      dossier={dossier}
    />
  );
}

/** A decision of «Giurisprudenza» in the index: its citation; the deposit in the tooltip. */
export function PracticeDecisionEntry({ practiceId, entry }: { practiceId: string; entry: PracticeDecision }) {
  const windowId = decisionWindowId(entry.id);
  const shown = useAppStore((s) => s.practices.find((p) => p.id === practiceId)?.beside.some((b) => b.id === windowId) === true);
  const openBeside = useAppStore((s) => s.openBeside);
  const removePracticeDecision = useAppStore((s) => s.removePracticeDecision);
  const dossier = useDecisionInDossier(entry);
  const deposit = formatDecisionDeposit({ tipo: entry.tipo, data_deposito: entry.depositDate });
  return (
    <IndexEntry
      shown={shown}
      onOpen={() => openBeside(practiceId, besideRefFor({ kind: 'decision', decisionId: entry.id }), undefined, { focus: true })}
      label={<span className="font-medium">{entry.label}</span>}
      title={entry.label + (deposit ? ` · ${deposit}` : '')}
      removeName={entry.label}
      onRemove={() => removePracticeDecision(practiceId, entry.id)}
      dossier={dossier}
    />
  );
}
