import { useMemo, useState } from 'react';
import { StickyNote, Filter, X } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { Annotation, Highlight } from '../../../../types';
import type { StudyModeTheme } from './StudyMode';
import {
  HIGHLIGHT_COLORS,
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
  notePillActive: string;
  notePillIdle: string;
  /** Opaque bg used by the sticky filter row so cards scrolling under it don't show through. */
  filterBg: string;
}> = {
  light: {
    card: 'bg-white border-slate-200/70',
    cardHover: 'hover:bg-slate-50 hover:border-slate-300',
    text: 'text-slate-900',
    muted: 'text-slate-500',
    notePillActive: 'bg-amber-500 text-white',
    notePillIdle: 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700',
    filterBg: 'bg-white',
  },
  dark: {
    card: 'bg-slate-800/60 border-slate-700/70',
    cardHover: 'hover:bg-slate-800 hover:border-slate-600',
    text: 'text-slate-100',
    muted: 'text-slate-400',
    notePillActive: 'bg-amber-500 text-white',
    notePillIdle: 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200',
    filterBg: 'bg-slate-900',
  },
  sepia: {
    card: 'bg-[#f4ecd8] border-[#d4c4a8]',
    cardHover: 'hover:bg-[#efe5d1] hover:border-[#b8a782]',
    text: 'text-[#5c4b37]',
    muted: 'text-[#8b7355]',
    notePillActive: 'bg-[#5c4b37] text-[#f4ecd8]',
    notePillIdle: 'bg-[#efe5d1] text-[#8b7355] hover:bg-[#e4d4b8] hover:text-[#5c4b37]',
    filterBg: 'bg-[#f4ecd8]',
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

  const hasActiveFilter = colorFilter !== 'all' || notesOnly;

  return (
    <div className="space-y-2.5">
      {/* Filter row — uniform row of round chips: 4 colour dots +
          divider + Note pill. The "all" state is implicit (no chip
          selected), so no explicit "Tutti" button. A reset X surfaces
          on the right only when at least one filter is active.
          Opaque background + bottom border so cards scrolling under
          the sticky row don't show through, and a small bottom margin
          to keep the active outline rings from clipping the divider. */}
      <div className={cn(
        'sticky -top-4 z-20 -mx-4 -mt-4 px-4 pt-4 pb-2.5 flex items-center gap-2 border-b',
        styles.filterBg,
        'border-current/10',
      )}>
        {HIGHLIGHT_COLORS.map((c) => {
          const active = colorFilter === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setColorFilter(active ? 'all' : c)}
              aria-pressed={active}
              className={cn(
                'flex items-center justify-center w-5 h-5 rounded-full transition-all',
                active
                  ? 'outline outline-2 outline-offset-2 outline-current scale-110'
                  : 'opacity-50 hover:opacity-100',
              )}
              style={{ backgroundColor: getHighlightSwatch(c) }}
              title={`Solo evidenziazioni ${c}`}
            />
          );
        })}
        <div className="w-px h-4 bg-current opacity-15 mx-1" aria-hidden />
        <button
          type="button"
          onClick={() => setNotesOnly((v) => !v)}
          aria-pressed={notesOnly}
          className={cn(
            'inline-flex items-center justify-center w-5 h-5 rounded-full transition-colors',
            notesOnly ? styles.notePillActive : styles.notePillIdle,
          )}
          title="Mostra solo note"
        >
          <StickyNote size={11} />
        </button>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => { setColorFilter('all'); setNotesOnly(false); }}
            className={cn('ml-auto inline-flex items-center justify-center w-5 h-5 rounded-full transition-colors hover:bg-current/10', styles.muted)}
            title="Azzera filtri"
            aria-label="Azzera filtri"
          >
            <X size={11} />
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
              'group w-full text-left flex items-stretch gap-2.5 rounded-lg border transition-colors overflow-hidden',
              styles.card,
              styles.cardHover,
            )}
          >
            {/* Coloured stripe = the highlight colour, or amber for notes.
                Replaces the previous saturated background on the anchor
                text, which was visually loud and duplicated the colour
                already shown in the article body. */}
            <div
              className="w-1 shrink-0"
              style={{
                backgroundColor: item.color
                  ? getHighlightSwatch(item.color)
                  : item.kind === 'note'
                    ? 'rgb(245 158 11)' /* amber-500 */
                    : 'transparent',
              }}
              aria-hidden
            />
            <div className="flex-1 min-w-0 py-2.5 pr-3">
              {item.anchorText && (
                <div className="flex items-start gap-1.5">
                  {item.kind === 'note' && (
                    <StickyNote size={11} className="mt-1 shrink-0 text-amber-500" />
                  )}
                  <p className={cn(
                    'text-sm leading-snug line-clamp-2',
                    item.kind === 'note'
                      ? cn('italic', styles.muted)
                      : styles.text,
                  )}>
                    {item.kind === 'note' ? <>&ldquo;{item.anchorText}&rdquo;</> : item.anchorText}
                  </p>
                </div>
              )}
              {item.noteText && (
                <p className={cn('text-sm whitespace-pre-wrap line-clamp-3', styles.text, item.anchorText && 'mt-1')}>
                  {item.noteText}
                </p>
              )}
              {item.createdAt && (
                <p className={cn('text-[10px] mt-1.5 opacity-50 tabular-nums', styles.muted)}>
                  {formatShortDate(item.createdAt)}
                </p>
              )}
            </div>
          </button>
        ))
      )}
    </div>
  );
}

/**
 * Compact Italian date format for the summary card timestamp:
 * "23 mar" for current year, "23 mar 2024" otherwise. Falls back to
 * the raw string if parsing fails.
 */
function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('it-IT', sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}
