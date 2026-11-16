import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { corpusPractices } from '../../../utils/practice';
import { useCompare } from '../../../hooks/useCompare';
import { cn } from '../../../lib/utils';
import { closeAllPracticesWithUndo } from './practiceUndo';
import { PracticeChip } from './PracticeChip';

const NEW_PRACTICE_LABEL = 'Nuova pratica';

const HEADER_BUTTON =
  'flex items-center gap-1 rounded-lg p-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

/**
 * The bar of practices (spec §5), in the dock's place (`fixed bottom-6`, `Z_INDEX.dock`, the tour's
 * `tour-practice-bar`): one chip per practice in the bar's order, reordered by drag; «+ Nuova
 * pratica»; «Chiudi tutte» behind its danger confirmation (the practices are persisted, so a reload
 * shows none); a collapse toggle. Hidden while the
 * comparison or the palette covers the page, as the old dock did. Its height, measured whenever it
 * changes (chips wrapping onto a new line, the bar collapsed), goes to `onHeightChange` — null while
 * it is not drawn — so the column keeps its last row clear of it (spec §3.4).
 */
export function PracticeBar({ onHeightChange }: { onHeightChange?: (height: number | null) => void } = {}) {
  const [barNode, setBarNode] = useState<HTMLElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const ids = useAppStore(useShallow((s) => corpusPractices(s.practices).map((p) => p.id)));
  const activePracticeId = useAppStore((s) => s.activePracticeId);
  const commandPaletteOpen = useAppStore((s) => s.commandPaletteOpen);
  const { createPractice, reorderPractices } = useAppStore(useShallow((s) => ({
    createPractice: s.createPractice,
    reorderPractices: s.reorderPractices,
  })));
  const { isOpen: isCompareOpen } = useCompare();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (!onHeightChange) return undefined;
    if (!barNode) {
      onHeightChange(null);
      return undefined;
    }
    // Nothing floats over the column since LC21: the room it keeps at its foot is the fallback's least.
    const measure = () => onHeightChange(0);
    measure();
    if (typeof ResizeObserver === 'undefined') return () => onHeightChange(null);
    const observer = new ResizeObserver(measure);
    observer.observe(barNode);
    return () => {
      observer.disconnect();
      onHeightChange(null);
    };
  }, [barNode, onHeightChange]);

  if (ids.length === 0 || isCompareOpen || commandPaletteOpen) return null;

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    reorderPractices(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };

  const newPractice = () => {
    setEditingId(createPractice(NEW_PRACTICE_LABEL, { activate: true }));
  };

  const count = `${ids.length} ${ids.length === 1 ? 'pratica' : 'pratiche'}`;

  return (
    // LC21: a row of tabs over the reading columns, in the page's flow, where it floated as a card at the bottom left
    // (the prototype has nothing floating over the text). It scrolls away with the page and the columns, sticky, stay.
    <nav
      ref={setBarNode}
      id="tour-practice-bar"
      aria-label="Pratiche"
      className="mb-4 flex min-w-0 items-center gap-3 border-b border-slate-200 pb-3 dark:border-slate-800"
    >
      <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">
        Pratiche <span className="sr-only">({count})</span>
      </span>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
          {/* Wraps rather than scrolls: a scrolling row would clip the chips' menus. */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {ids.map((id) => (
              <PracticeChip
                key={id}
                practiceId={id}
                isActive={id === activePracticeId}
                editing={editingId === id}
                onEditingChange={(editing) => setEditingId(editing ? id : null)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={newPractice} className={HEADER_BUTTON}>
          <Plus size={14} aria-hidden />
          Nuova pratica
        </button>
        <button
          type="button"
          onClick={closeAllPracticesWithUndo}
          aria-label="Chiudi tutte le pratiche"
          title="Chiudi tutte"
          className={cn(HEADER_BUTTON, 'hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30')}
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </nav>
  );
}
