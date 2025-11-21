import { DndContext, DragOverlay, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { WorkspaceTabPanel } from './WorkspaceTabPanel';
import type { ArticleData } from '../../../types';

interface WorkspaceManagerProps {
  onViewPdf: (urn: string) => void;
  onCompareArticle: (article: ArticleData) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
}

interface DragData {
  type: 'norma' | 'loose-article';
  itemId: string;
  sourceTabId: string;
}

export function WorkspaceManager({
  onViewPdf,
  onCompareArticle,
  onCrossReference
}: WorkspaceManagerProps) {
  const { workspaceTabs, moveNormaBetweenTabs, moveLooseArticleBetweenTabs } = useAppStore();
  const [activeItem, setActiveItem] = useState<DragData | null>(null);

  // Configure sensors for drag detection
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Requires 8px movement to start drag
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveItem(active.data.current as DragData);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || !active.data.current) {
      setActiveItem(null);
      return;
    }

    const dragData = active.data.current as DragData;
    const targetTabId = over.id as string;

    // Don't do anything if dropped on same tab
    if (dragData.sourceTabId === targetTabId) {
      setActiveItem(null);
      return;
    }

    // Move based on type
    if (dragData.type === 'norma') {
      moveNormaBetweenTabs(dragData.itemId, dragData.sourceTabId, targetTabId);
    } else if (dragData.type === 'loose-article') {
      moveLooseArticleBetweenTabs(dragData.itemId, dragData.sourceTabId, targetTabId);
    }

    setActiveItem(null);
  };

  const handleDragCancel = () => {
    setActiveItem(null);
  };

  // Sort tabs by zIndex to ensure proper stacking order
  const sortedTabs = [...workspaceTabs].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {sortedTabs.map(tab => (
        <WorkspaceTabPanel
          key={tab.id}
          tab={tab}
          onViewPdf={onViewPdf}
          onCompareArticle={onCompareArticle}
          onCrossReference={onCrossReference}
        />
      ))}

      <DragOverlay>
        {activeItem && (
          <div className="bg-blue-100 dark:bg-blue-900 border-2 border-blue-500 rounded-lg p-3 opacity-90 shadow-xl">
            <div className="text-sm font-medium text-blue-900 dark:text-blue-100">
              {activeItem.type === 'norma' ? 'Norma' : 'Articolo Loose'}
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
