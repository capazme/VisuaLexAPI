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
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useAppStore } from '../../../store/useAppStore';
import type { ArticleData } from '../../../types';
import { actHeading } from '../../../utils/sources';
import { PracticeActBlock } from './PracticeActBlock';
import { PracticeDecisionsSection } from './PracticeDecisionsSection';

export interface PracticeColumnProps {
  practiceId: string;
  onViewPdf: (urn: string) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
}

/**
 * The practice's column (spec §3, D3): its acts one under the other, in their order and reordered
 * by drag (pointer and keyboard, as the dossier's acts); «Giurisprudenza» follows them (§3.3).
 * It takes the practice's reveal (`takeReveal`, once, gotcha 14) and scrolls the revealed row into
 * view: the row is already open, the store opened it in the same step.
 */
export function PracticeColumn({ practiceId, onViewPdf, onCrossReference }: PracticeColumnProps) {
  const practice = useAppStore((s) => s.practices.find((p) => p.id === practiceId));
  const reorderActs = useAppStore((s) => s.reorderActs);
  const takeReveal = useAppStore((s) => s.takeReveal);
  const revealKey = useAppStore((s) => (s.pendingReveal?.practiceId === practiceId ? s.pendingReveal.rowKey : null));
  const columnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!revealKey) return;
    // Taken in one step: a second invocation (StrictMode) finds nothing and does nothing.
    const taken = takeReveal(practiceId);
    if (!taken) return;
    const rows = columnRef.current?.querySelectorAll<HTMLElement>('[data-practice-row]') ?? [];
    const row = Array.from(rows).find((el) => el.dataset.practiceRow === taken.rowKey);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    row?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  }, [revealKey, practiceId, takeReveal]);

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
    // The bar of practices floats over the results area (`fixed bottom-6`, about 48 px high, §5):
    // the column keeps its last row clear of it, bar plus offset plus a margin (§3.4).
    <div ref={columnRef} data-testid="practice-column" className="space-y-3 pb-24">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: "Per spostare l'atto premi Spazio, poi le frecce su e giù, e di nuovo Spazio per lasciarlo; Esc annulla." },
        }}
      >
        <SortableContext items={actIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {practice.acts.map((act) => (
              <PracticeActBlock
                key={act.id}
                practiceId={practiceId}
                act={act}
                onViewPdf={onViewPdf}
                onCrossReference={onCrossReference}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <PracticeDecisionsSection practiceId={practiceId} />
    </div>
  );
}
