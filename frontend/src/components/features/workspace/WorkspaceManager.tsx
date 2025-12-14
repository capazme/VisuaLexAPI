import { DndContext, DragOverlay, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { WorkspaceTabPanel } from './WorkspaceTabPanel';
import type { ArticleData } from '../../../types';

interface WorkspaceManagerProps {
  onViewPdf: (urn: string) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
}

interface DragData {
  type: 'norma' | 'loose-article';
  itemId: string;
  sourceTabId: string;
  sourceNorma?: any; // For loose articles
}

interface DropData {
  type: 'norma-drop-zone';
  normaId: string;
  tabId: string;
  norma: any;
}

export function WorkspaceManager({
  onViewPdf,
  onCrossReference
}: WorkspaceManagerProps) {
  const { workspaceTabs, moveNormaBetweenTabs, moveLooseArticleBetweenTabs, mergeLooseArticleToNorma, moveLooseArticleToCollection } = useAppStore();
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
    const overId = over.id as string;

    // Check if dropping on a NormaBlock (merge loose article)
    if (overId.startsWith('norma-drop-') && dragData.type === 'loose-article') {
      const dropData = over.data.current as DropData;

      // Verify compatibility: same source norma
      if (dragData.sourceNorma) {
        const isSameNorma =
          dragData.sourceNorma.tipo_atto === dropData.norma.tipo_atto &&
          dragData.sourceNorma.numero_atto === dropData.norma.numero_atto &&
          dragData.sourceNorma.data === dropData.norma.data;

        if (isSameNorma) {
          mergeLooseArticleToNorma(dropData.tabId, dragData.itemId, dropData.normaId);
        }
      }

      setActiveItem(null);
      return;
    }

    // Check if dropping on a Collection
    if (overId.startsWith('collection-drop-') && dragData.type === 'loose-article') {
      const dropData = over.data.current as { type: string; collectionId: string; tabId: string };
      moveLooseArticleToCollection(dropData.tabId, dragData.itemId, dropData.collectionId);
      setActiveItem(null);
      return;
    }

    // Don't do anything if dropped on same tab (for tab-to-tab moves)
    if (dragData.sourceTabId === overId) {
      setActiveItem(null);
      return;
    }

    // Move based on type (between tabs)
    if (dragData.type === 'norma') {
      moveNormaBetweenTabs(dragData.itemId, dragData.sourceTabId, overId);
    } else if (dragData.type === 'loose-article') {
      moveLooseArticleBetweenTabs(dragData.itemId, dragData.sourceTabId, overId);
    }

    setActiveItem(null);
  };

  const handleDragCancel = () => {
    setActiveItem(null);
  };

  // Sort tabs by zIndex to ensure proper stacking order, filter out hidden tabs
  const sortedTabs = [...workspaceTabs]
    .filter(tab => !tab.isHidden)
    .sort((a, b) => a.zIndex - b.zIndex);

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
