import { useMemo, useState } from 'react';
import { Highlighter, StickyNote, Filter, X } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { Annotation, Highlight } from '../../../../types';
import type { StudyModeTheme } from './StudyMode';
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_STYLES,
  parseInlineStyle,
  getHighlightSwatch,
  type HighlightColor,
} from '../../../../utils/highlightColors';

/**
 * Unified chronological (by reading position) view over every highlight
 * and annotation for the current article. Designed for study review:
 * the user sees what they flagged in the order the text flows, jumps
 * back to each span by clicking an item, and can filter down to a
 * specific colour or "only notes" when focusing on one thread.
 */

type Kind = 'highlight' | 'note';
type ColorFilter = HighlightColor | 'all';

interface SummaryItem {
  kind: Kind;
  id: string;
  /** Plain text of the anchored span (highlight text, or note's anchorText). `null` for un-anchored notes. */
  anchorText: string | null;
  /** Note body. Null for highlights. */
  noteText: string | null;
  color: HighlightColor | null;
  createdAt: string | null;
  /** Used both for sort order and to locate the item in the DOM for scrollIntoView. */
  startOffset: number;
}

interface StudyModeSummaryProps {
  highlights: Highlight[];
  annotations: Annotation[];
  theme: StudyModeTheme;
  /**
   * Called with the item's (kind, id) when the user clicks a card.
   * Parent wires this to scroll the corresponding `<mark>` or
   * `.note-anchor` span into view — both carry matching data
   * attributes emitted by useArticleMarkers.
   */
  onNavigate: (kind: Kind, id: string) => void;
}

const THEME_STYLES: Record<StudyModeTheme, {
  card: string;
  cardHover: string;
  text: string;
  muted: string;
  filterActive: string;
  filterIdle: string;
}> = {
  light: {
    card: 'bg-white border-slate-200 hover:border-slate-300',
    cardHover: 'hover:bg-slate-50',
    text: 'text-slate-900',
    muted: 'text-slate-500',
    filterActive: 'bg-slate-800 text-white border-slate-800',
    filterIdle: 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
  },
  dark: {
    card: 'bg-slate-800 border-slate-700 hover:border-slate-600',
    cardHover: 'hover:bg-slate-700/50',
    text: 'text-slate-100',
    muted: 'text-slate-400',
    filterActive: 'bg-slate-100 text-slate-900 border-slate-100',
    filterIdle: 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600',
  },
  sepia: {
    card: 'bg-[#f4ecd8] border-[#d4c4a8] hover:border-[#b8a782]',
    cardHover: 'hover:bg-[#efe5d1]',
    text: 'text-[#5c4b37]',
    muted: 'text-[#8b7355]',
    filterActive: 'bg-[#5c4b37] text-[#f4ecd8] border-[#5c4b37]',
    filterIdle: 'bg-[#f4ecd8] text-[#8b7355] border-[#d4c4a8] hover:border-[#b8a782]',
  },
};

export function StudyModeSummary({
  highlights,
  annotations,
  theme,
  onNavigate,
}: StudyModeSummaryProps) {
  const styles = THEME_STYLES[theme];
  const [colorFilter, setColorFilter] = useState<ColorFilter>('all');
  const [notesOnly, setNotesOnly] = useState(false);

  // Merge into a single flat list and sort by position in the article.
  // Items with no startOffset (legacy highlights pre-offset feature,
  // un-anchored notes) fall to the bottom in stable insertion order.
  const items = useMemo<SummaryItem[]>(() => {
    const hlItems: SummaryItem[] = highlights.map((h) => ({
      kind: 'highlight',
      id: h.id,
      anchorText: h.text,
      noteText: null,
      color: h.color,
      createdAt: null,
      startOffset: typeof h.startOffset === 'number' ? h.startOffset : Number.MAX_SAFE_INTEGER,
    }));
    const noteItems: SummaryItem[] = annotations.map((a) => ({
      kind: 'note',
      id: a.id,
      anchorText: a.anchorText ?? null,
      noteText: a.text,
      color: null,
      createdAt: a.createdAt,
      startOffset: typeof a.startOffset === 'number' ? a.startOffset : Number.MAX_SAFE_INTEGER,
    }));
    return [...hlItems, ...noteItems].sort((x, y) => x.startOffset - y.startOffset);
  }, [highlights, annotations]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (notesOnly && item.kind !== 'note') return false;
      if (colorFilter !== 'all' && item.kind === 'highlight' && item.color !== colorFilter) return false;
      return true;
    });
  }, [items, notesOnly, colorFilter]);

  if (items.length === 0) {
    return (
      <div className={cn('text-sm text-center py-10 flex flex-col items-center gap-2', styles.muted)}>
        <Filter size={24} className="opacity-30" />
        <div>
          Nessuna evidenziazione o nota per questo articolo.
          <br />
          <span className="text-xs opacity-70">Seleziona del testo per iniziare.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5 sticky top-0 z-10 py-1 -my-1">
        <button
          type="button"
          onClick={() => setColorFilter('all')}
          className={cn(
            'px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide rounded-md border transition-colors',
            colorFilter === 'all' ? styles.filterActive : styles.filterIdle,
          )}
        >
          Tutti
        </button>
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColorFilter(c)}
            className={cn(
              'flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide rounded-md border transition-colors',
              colorFilter === c ? styles.filterActive : styles.filterIdle,
            )}
            title={`Solo highlight ${c}`}
          >
            <span
              className="inline-block w-3 h-3 rounded-sm ring-1 ring-black/10 dark:ring-white/20"
              style={{ backgroundColor: getHighlightSwatch(c) }}
            />
            {c}
          </button>
        ))}
        <div className="w-px h-4 bg-current opacity-20 mx-1" />
        <button
          type="button"
          onClick={() => setNotesOnly((v) => !v)}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide rounded-md border transition-colors',
            notesOnly ? styles.filterActive : styles.filterIdle,
          )}
        >
          <StickyNote size={11} />
          Solo note
        </button>
        {(colorFilter !== 'all' || notesOnly) && (
          <button
            type="button"
            onClick={() => {
              setColorFilter('all');
              setNotesOnly(false);
            }}
            className={cn('ml-auto p-1 rounded-md transition-colors', styles.muted, 'hover:bg-slate-100 dark:hover:bg-slate-700')}
            title="Azzera filtri"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Items */}
      {filtered.length === 0 ? (
        <div className={cn('text-xs text-center py-6', styles.muted)}>
          Nessun risultato per questi filtri.
        </div>
      ) : (
        filtered.map((item) => (
          <button
            key={`${item.kind}-${item.id}`}
            type="button"
            onClick={() => onNavigate(item.kind, item.id)}
            className={cn(
              'w-full text-left p-3 rounded-lg border transition-colors',
              styles.card,
              styles.cardHover,
            )}
          >
            <div className="flex items-start gap-2">
              {item.kind === 'highlight' ? (
                <Highlighter size={12} className="mt-0.5 shrink-0 opacity-70" />
              ) : (
                <StickyNote size={12} className="mt-0.5 shrink-0 opacity-70 text-amber-500" />
              )}
              <div className="flex-1 min-w-0">
                {item.anchorText && (
                  <p
                    style={item.color ? parseInlineStyle(HIGHLIGHT_STYLES[item.color]) : undefined}
                    className={cn(
                      'inline-block rounded px-1 text-xs leading-snug line-clamp-3',
                      !item.color && cn('italic text-amber-700 dark:text-amber-400 px-0'),
                    )}
                  >
                    {item.anchorText}
                  </p>
                )}
                {item.noteText && (
                  <p className={cn('text-sm mt-1.5 whitespace-pre-wrap line-clamp-3', styles.text)}>
                    {item.noteText}
                  </p>
                )}
                {item.createdAt && (
                  <p className={cn('text-[10px] mt-1.5 opacity-60', styles.muted)}>
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          </button>
        ))
      )}
    </div>
  );
}
