import { useCallback, useState } from 'react';
import { CheckSquare, ChevronDown, Plus, Square, Star, StickyNote, Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { historicalItemLabel } from '../../../utils/versionDisplay';
import { getRubricText, parseArticleStructure } from '../../../utils/articleStructure';
import type { ArticleData, DossierItem } from '../../../types';
import { DossierItemReader } from './DossierItemReader';
import { shownAnnex } from './dossierLayout';
import { ClaudeMark } from '../../ui/ClaudeMark';
import { claudeMarkSentence } from '../../ui/claudeMarkSentence';
import { formatTimestampLong } from './dossierUtils';
import { FOCUS_RING } from '../studia/progress/tokens';
import { ROW, ROW_ICON, ROW_LINE, ROW_REMOVE, ROW_TITLE } from './dossierStyles';

type NormaItem = Extract<DossierItem, { type: 'norma' }>;
type NoteItem = Extract<DossierItem, { type: 'note' }>;

export interface DossierArticleRowProps {
  item: NormaItem;
  /** From the act's index (`useActDetails`); the row fills it from the text when absent. */
  rubrica: string | null;
  isSelected: boolean;
  showCheckbox: boolean;
  onToggleSelect: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenOnDashboard: () => void;
  onRemove: () => void;
  onToggleImportant: () => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  /** The notes about this article as a whole (spec §6). */
  notes?: NoteItem[];
  onAddNote?: () => void;
  onRemoveNote?: (note: NoteItem) => void;
}

/**
 * One article inside its act's block, a row of two levels as the planner's tasks (S7c): «art. 3» over a grey line, its
 * rubric (else when it was added), the signs at the right, then the star and the removal, 44 px at every width; the
 * text read in place (spec §5). The act is named once by the block, so the row never repeats it.
 */
export function DossierArticleRow({
  item, rubrica, isSelected, showCheckbox, onToggleSelect, isExpanded, onToggleExpand,
  onOpenOnDashboard, onRemove, onToggleImportant, showToast,
  notes = [], onAddNote, onRemoveNote,
}: DossierArticleRowProps) {
  const [textRubrica, setTextRubrica] = useState<string | null>(null);
  const onArticle = useCallback((article: ArticleData) => {
    const raw = article.article_text || '';
    setTextRubrica(raw ? getRubricText(raw, parseArticleStructure(raw)) : null);
  }, []);

  const shownRubrica = rubrica ?? textRubrica;
  // The grey line: the rubric, else when it was added; nothing when neither is known.
  const added = formatTimestampLong(item.addedAt);
  const greyLine = shownRubrica ?? (added ? `Aggiunto il ${added}` : null);
  const annex = shownAnnex(item.data);
  const isImportant = item.status === 'important';
  // "Testo al 29/12/2007": a row that holds a past text says so.
  const historicalLabel = historicalItemLabel(item.data);
  const verb = isExpanded ? 'Comprimi' : 'Espandi';
  // The accessible name replaces the row's content, so it names the act (two
  // laws' art. 3 must never read alike) and the version (two versions of one
  // article neither).
  const named = item.citation
    ?? `${item.data.tipo_atto}${item.data.numero_atto ? ` ${item.data.numero_atto}` : ''} articolo ${item.data.numero_articolo}`;
  const rowLabel = `${verb} ${named}`
    + (historicalLabel ? `, ${historicalLabel.charAt(0).toLowerCase()}${historicalLabel.slice(1)}` : '');
  const regionId = `dossier-item-content-${item.id}`;
  const byApp = notes.find((n) => n.createdBy)?.createdBy ?? null;
  // The closed row's note count and mark sit inside the toggle, whose own name
  // replaces them for a screen reader: the name has to say them.
  const notesLabel = notes.length === 0 || isExpanded ? '' : `, ${notes.length === 1 ? '1 nota' : `${notes.length} note`}`
    + (byApp ? `, ${notes.length === 1 ? '' : 'una '}${claudeMarkSentence(byApp)}` : '');

  return (
    <div className={cn(ROW, 'pl-3 transition-colors', isSelected ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40')}>
      {isImportant && <span aria-hidden className="absolute bottom-2 left-0 top-2 w-1 rounded bg-amber-400" />}
      <div className="flex items-start gap-1">
        {showCheckbox && (
          <button
            type="button"
            onClick={onToggleSelect}
            aria-label={isSelected ? 'Deseleziona elemento' : 'Seleziona elemento'}
            aria-pressed={isSelected}
            className={cn(ROW_ICON, 'text-slate-500 hover:text-primary-700 dark:text-slate-400 dark:hover:text-primary-300')}
          >
            {isSelected ? <CheckSquare size={18} className="text-primary-600 dark:text-primary-400" /> : <Square size={18} />}
          </button>
        )}
        {/* The expand toggle wraps only text: the star and the remove button stay
            outside it, since ARIA makes a role="button"'s descendants presentational. Two levels, as the planner's
            tasks (S7c): the article, then a grey line — its rubric, else when it was added —, the signs at the right. */}
        <div
          role="button"
          tabIndex={0}
          aria-label={rowLabel + notesLabel}
          aria-expanded={isExpanded}
          aria-controls={isExpanded ? regionId : undefined}
          onClick={onToggleExpand}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleExpand();
            }
          }}
          className={cn('flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-md py-2.5', FOCUS_RING)}
        >
          <ChevronDown
            size={16}
            aria-hidden
            className={cn('mt-0.5 flex-shrink-0 text-slate-500 transition-transform motion-reduce:transition-none dark:text-slate-400', !isExpanded && '-rotate-90')}
          />
          <span className="min-w-0 flex-1">
            <span className={cn(ROW_TITLE, 'block font-medium')}>art. {item.data.numero_articolo}</span>
            {greyLine && <span className={cn(ROW_LINE, 'mt-0.5 line-clamp-2 block')}>{greyLine}</span>}
          </span>
          <span className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1.5 pt-0.5">
            {annex && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                All. {annex}
              </span>
            )}
            {historicalLabel && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                {historicalLabel}
              </span>
            )}
            {notes.length > 0 && !isExpanded && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-800 dark:text-amber-300" title={notes.length === 1 ? '1 nota' : `${notes.length} note`}>
                <StickyNote size={13} aria-hidden />
                {notes.length}
                <span className="sr-only">{notes.length === 1 ? 'nota' : 'note'}</span>
              </span>
            )}
            {notes.length > 0 && !isExpanded && byApp && <ClaudeMark createdBy={byApp} compact />}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleImportant}
          aria-pressed={isImportant}
          aria-label={isImportant ? 'Rimuovi da importanti' : 'Segna come importante'}
          title={isImportant ? 'Importante' : 'Segna come importante'}
          className={cn(
            ROW_ICON,
            isImportant
              ? 'text-amber-500'
              : 'text-slate-400 hover:bg-amber-50 hover:text-amber-600 dark:text-slate-500 dark:hover:bg-amber-900/20',
          )}
        >
          <Star size={16} className={cn(isImportant && 'fill-amber-400')} />
        </button>
        <button type="button" onClick={onRemove} aria-label="Rimuovi articolo dal dossier" className={ROW_REMOVE}>
          <Trash2 size={16} aria-hidden />
        </button>
      </div>
      {isExpanded && (
        <div id={regionId} className="pb-3 pl-6 pr-2">
          {/* The article's notes first, then its text (spec §6). */}
          {(notes.length > 0 || onAddNote) && (
            <div className="mb-2 mt-1 space-y-1.5">
              {notes.map((note) => (
                <div key={note.id} className="group/note flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/20">
                  <StickyNote size={14} aria-hidden className="mt-0.5 flex-shrink-0 text-amber-600" />
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">{note.data}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>{formatTimestampLong(note.addedAt)}</span>
                      <ClaudeMark createdBy={note.createdBy ?? null} />
                    </div>
                  </div>
                  {onRemoveNote && (
                    <button
                      type="button"
                      onClick={() => onRemoveNote(note)}
                      aria-label="Rimuovi nota"
                      className={ROW_REMOVE}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  )}
                </div>
              ))}
              {onAddNote && (
                <button
                  type="button"
                  onClick={onAddNote}
                  className={cn('-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 text-sm font-medium text-amber-800 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30', FOCUS_RING)}
                >
                  <Plus size={13} aria-hidden /> Aggiungi una nota all'articolo
                </button>
              )}
            </div>
          )}
          <DossierItemReader
            norma={item.data}
            onOpenOnDashboard={onOpenOnDashboard}
            showToast={showToast}
            onArticle={onArticle}
          />
        </div>
      )}
    </div>
  );
}
