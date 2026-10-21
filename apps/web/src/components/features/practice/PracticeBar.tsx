import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Layers, Plus, X } from 'lucide-react';
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
import { useCompare } from '../../../hooks/useCompare';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
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
  const [isExpanded, setIsExpanded] = useState(true);
  const [barNode, setBarNode] = useState<HTMLDivElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const ids = useAppStore(useShallow((s) => s.practices.map((p) => p.id)));
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
    const measure = () => onHeightChange(barNode.offsetHeight);
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
    setIsExpanded(true);
    setEditingId(createPractice(NEW_PRACTICE_LABEL, { activate: true }));
  };

  const count = `${ids.length} ${ids.length === 1 ? 'pratica' : 'pratiche'}`;

  return (
    <>
      <div ref={setBarNode} id="tour-practice-bar" className={cn('fixed bottom-6 left-1/2 -translate-x-1/2', Z_INDEX.dock)}>
        {!isExpanded ? (
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            aria-expanded={false}
            className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 shadow-lg transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <Layers size={18} aria-hidden className="text-primary-500" />
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{count}</span>
            <ChevronUp size={14} aria-hidden className="text-slate-400" />
          </button>
        ) : (
          <nav
            aria-label="Pratiche"
            className="rounded-2xl border border-slate-200/60 bg-white/95 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95"
          >
            <div className="flex items-center justify-between gap-4 rounded-t-2xl border-b border-slate-200/60 bg-slate-50/50 px-4 py-2 dark:border-slate-800 dark:bg-slate-900/50">
              <div className="flex items-center gap-2">
                <Layers size={14} aria-hidden className="text-primary-500" />
                <span className="text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">Pratiche</span>
                <span className="rounded-md bg-primary-100 px-1.5 py-0.5 text-xs font-bold text-primary-700 dark:bg-primary-900/50 dark:text-primary-300">
                  {ids.length}
                </span>
              </div>
              <div className="flex items-center gap-1">
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
                <button
                  type="button"
                  onClick={() => setIsExpanded(false)}
                  aria-label="Comprimi la barra delle pratiche"
                  aria-expanded
                  className={HEADER_BUTTON}
                >
                  <ChevronDown size={14} aria-hidden />
                </button>
              </div>
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
                {/* Wraps rather than scrolls: a scrolling row would clip the chips' menus. */}
                <div className="flex max-w-[90vw] flex-wrap gap-2 p-3">
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
          </nav>
        )}
      </div>
    </>
  );
}
