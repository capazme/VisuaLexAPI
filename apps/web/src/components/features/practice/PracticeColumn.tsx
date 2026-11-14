import { useEffect, useMemo, useRef } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import type { ArticleData } from '../../../types';
import { actHeading } from '../../../utils/sources';
import { OVERVIEW_GRID } from './besideLayout';
import { PracticeActBlock } from './PracticeActBlock';
import { PracticeDecisionsSection } from './PracticeDecisionsSection';

/**
 * How the column draws the practice (U2): the phone's column (its acts one under the other, as R3 left it), the
 * desktop's overview (a grid of panels, «Giurisprudenza» a strip under them) or the reading view's index (each act its
 * heading and its articles, one entry a line, beside the windows).
 */
export type PracticeLayout = 'phone' | 'overview' | 'index';

/** The room between the acts and before «Giurisprudenza»: the overview's grid gap, the index's entries, the phone's. */
const GAP: Record<PracticeLayout, string> = { phone: 'space-y-3', overview: 'space-y-6', index: 'space-y-4' };

export interface PracticeColumnProps {
  practiceId: string;
  onViewPdf: (urn: string) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
  layout: PracticeLayout;
}

/**
 * The practice's column (spec §3, D3; U2): its acts in their order — one under the other on a phone and in the index, a
 * grid of panels in the overview — reordered by drag (pointer and keyboard, as the dossier's acts); «Giurisprudenza»
 * follows them (§3.3). Outside the index it takes the practice's reveal (`takeReveal`, once, gotcha 14) and scrolls the
 * revealed row into view: the row is already open, the store opened it in the same step. The index draws no row to
 * open: `ReadingRow` takes the reveal there and opens the row's subject beside.
 */
export function PracticeColumn({ practiceId, onViewPdf, onCrossReference, layout }: PracticeColumnProps) {
  const practice = useAppStore((s) => s.practices.find((p) => p.id === practiceId));
  const reorderActs = useAppStore((s) => s.reorderActs);
  const takeReveal = useAppStore((s) => s.takeReveal);
  const revealKey = useAppStore((s) => (s.pendingReveal?.practiceId === practiceId ? s.pendingReveal.rowKey : null));
  const columnRef = useRef<HTMLDivElement>(null);
  const isIndex = layout === 'index';

  useEffect(() => {
    if (!revealKey || isIndex) return;
    // Taken in one step: a second invocation (StrictMode) finds nothing and does nothing.
    const taken = takeReveal(practiceId);
    if (!taken) return;
    const rows = columnRef.current?.querySelectorAll<HTMLElement>('[data-practice-row]') ?? [];
    const row = Array.from(rows).find((el) => el.dataset.practiceRow === taken.rowKey);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    row?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  }, [revealKey, isIndex, practiceId, takeReveal]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const acts = practice?.acts;
  const actIds = useMemo(() => (acts ?? []).map((a) => a.id), [acts]);
  // What a screen reader hears while an act is dragged: its heading, never its id.
  const announcements = useMemo(() => {
    const heading = (id: string | number) => {
      const held = acts?.find((a) => a.id === String(id));
      return held ? actHeading(held.norma) : '';
    };
    return {
      onDragStart: ({ active }: { active: { id: string | number } }) => `Spostamento di ${heading(active.id)} iniziato.`,
      onDragOver: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
        over ? `${heading(active.id)} sopra ${heading(over.id)}.` : `${heading(active.id)} fuori dall'elenco degli atti.`,
      onDragEnd: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
        over ? `${heading(active.id)} spostato al posto di ${heading(over.id)}.` : `${heading(active.id)} lasciato dov'era.`,
      onDragCancel: ({ active }: { active: { id: string | number } }) => `Spostamento di ${heading(active.id)} annullato.`,
    };
  }, [acts]);

  if (!practice) return null;

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    reorderActs(practiceId, actIds.indexOf(String(active.id)), actIds.indexOf(String(over.id)));
  };

  return (
    // The bar of practices floats over the results area (`fixed bottom-6`, §5): the column keeps its
    // last row clear of it (§3.4), the bar's measured height (`--practice-bar-height`, set by
    // `SearchPanel` from `PracticeBar`; it grows when the chips wrap) plus its 24 px offset and a
    // 12 px margin. Without the bar (the phone, the bar hidden) the fallback keeps today's 96 px.
    <div
      ref={columnRef}
      data-testid="practice-column"
      data-layout={layout}
      className={cn(GAP[layout], 'pb-[calc(var(--practice-bar-height,3.75rem)+2.25rem)]')}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        accessibility={{
          announcements,
          // In the overview's grid the arrows to the sides move an act too.
          screenReaderInstructions: {
            draggable: `Per spostare l'atto premi Spazio, poi le frecce${layout === 'overview' ? '' : ' su e giù'}, e di nuovo Spazio per lasciarlo; Esc annulla.`,
          },
        }}
      >
        <SortableContext items={actIds} strategy={layout === 'overview' ? rectSortingStrategy : verticalListSortingStrategy}>
          <div data-testid="practice-acts" className={layout === 'overview' ? OVERVIEW_GRID : GAP[layout]}>
            {practice.acts.map((act) => (
              <PracticeActBlock
                key={act.id}
                practiceId={practiceId}
                act={act}
                onViewPdf={onViewPdf}
                onCrossReference={onCrossReference}
                layout={layout}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <PracticeDecisionsSection practiceId={practiceId} layout={layout} />
    </div>
  );
}
