import { useState } from 'react';
import {
  Layers,
  ChevronUp,
  ChevronDown,
  AlignJustify,
  X,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../../lib/utils';
import { useCompare } from '../../../hooks/useCompare';
import { Z_INDEX } from '../../../constants/zIndex';
import { SortableWorkspaceTab } from './SortableWorkspaceTab';
import { ConfirmDialog } from '../../ui/ConfirmDialog';

interface WorkspaceNavigatorProps {
  className?: string;
}

/**
 * Global workspace navigator showing all open tabs.
 * Provides quick access to switch between tabs, preview content, and manage tabs.
 */
export function WorkspaceNavigator({ className }: WorkspaceNavigatorProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [closeAllOpen, setCloseAllOpen] = useState(false);

  const {
    workspaceTabs,
    bringTabToFront,
    removeTab,
    toggleTabMinimize,
    toggleTabVisibility,
    reorderWorkspaceTabs,
    arrangeWorkspaceTabs,
    closeAllWorkspaceTabs,
    commandPaletteOpen,
  } = useAppStore(useShallow(s => ({
    workspaceTabs: s.workspaceTabs,
    bringTabToFront: s.bringTabToFront,
    removeTab: s.removeTab,
    toggleTabMinimize: s.toggleTabMinimize,
    toggleTabVisibility: s.toggleTabVisibility,
    reorderWorkspaceTabs: s.reorderWorkspaceTabs,
    arrangeWorkspaceTabs: s.arrangeWorkspaceTabs,
    closeAllWorkspaceTabs: s.closeAllWorkspaceTabs,
    commandPaletteOpen: s.commandPaletteOpen,
  })));

  // Check if compare view is open
  const { isOpen: isCompareOpen } = useCompare();

  // Hide dock when heavy overlays are active
  const shouldHide = isCompareOpen || commandPaletteOpen;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = workspaceTabs.findIndex(t => t.id === active.id);
    const to = workspaceTabs.findIndex(t => t.id === over.id);
    if (from < 0 || to < 0) return;
    reorderWorkspaceTabs(from, to);
  };

  if (workspaceTabs.length === 0 || shouldHide) return null;

  // The tab with the highest zIndex is the one currently "in front" — used to
  // highlight the active chip. Rendering order now follows `workspaceTabs`
  // (array order = drag order) instead of a zIndex sort, otherwise a reorder
  // wouldn't change what the user sees.
  const activeTabId = [...workspaceTabs].sort((a, b) => b.zIndex - a.zIndex)[0]?.id ?? null;

  return (
    <>
    <div
      id="tour-workspace-dock"
      className={cn(
        "fixed bottom-6 left-1/2 -translate-x-1/2",
        Z_INDEX.dock,
        className
      )}
    >
      {/* Collapsed toggle button */}
      {!isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-800 rounded-full shadow-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all hover:scale-105"
        >
          <Layers size={18} className="text-primary-500" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {workspaceTabs.length} tab
          </span>
          <ChevronUp size={14} className="text-slate-400" />
        </button>
      )}

      {/* Expanded navigator */}
      {isExpanded && (
        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/60 dark:border-slate-800 overflow-hidden ring-1 ring-black/5 animate-in slide-in-from-bottom-5 duration-300">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-2">
              <Layers size={14} className="text-primary-500" />
              <span className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">
                Workspace
              </span>
              <span className="text-xs bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 px-1.5 py-0.5 rounded-md font-bold">
                {workspaceTabs.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={arrangeWorkspaceTabs}
                aria-label="Allinea le finestre"
                title="Allinea finestre"
                className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors focus-ring"
              >
                <AlignJustify size={14} aria-hidden className="text-slate-400" />
              </button>
              <button
                onClick={() => setCloseAllOpen(true)}
                disabled={workspaceTabs.length === 0}
                aria-label="Chiudi tutte le tab"
                title="Chiudi tutte"
                className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors focus-ring"
              >
                <X size={14} aria-hidden className="text-slate-400 hover:text-red-500" />
              </button>
              <button
                onClick={() => setIsExpanded(false)}
                aria-label="Comprimi il workspace"
                aria-expanded
                className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors focus-ring"
              >
                <ChevronDown size={14} aria-hidden className="text-slate-400" />
              </button>
            </div>
          </div>

          {/* Tab list */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={workspaceTabs.map(t => t.id)} strategy={horizontalListSortingStrategy}>
              <div className="flex gap-3 p-4 max-w-[90vw] overflow-x-auto custom-scrollbar">
                {workspaceTabs.map((tab) => (
                  <SortableWorkspaceTab
                    key={tab.id}
                    tab={tab}
                    isActive={tab.id === activeTabId}
                    onBringToFront={bringTabToFront}
                    onToggleVisibility={toggleTabVisibility}
                    onToggleMinimize={toggleTabMinimize}
                    onRemove={removeTab}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* Keyboard hint */}
          <div className="px-4 py-1.5 border-t border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
              Click per portare in primo piano • Trascina per riordinare • Allinea con ⬌
            </span>
          </div>
        </div>
      )}
    </div>
    {/* The workspace is persisted, so "close all" throws away every open
        tab at once; a destructive action gets the confirm every other one has. */}
    <ConfirmDialog
      open={closeAllOpen}
      variant="danger"
      title="Chiudere tutte le tab?"
      message={`${workspaceTabs.length === 1 ? 'La tab aperta' : `Le ${workspaceTabs.length} tab aperte`} nel workspace ${workspaceTabs.length === 1 ? 'verrà chiusa' : 'verranno chiuse'}. Dossier, segnalibri, note ed evidenziazioni non saranno toccati.`}
      confirmLabel="Chiudi tutte"
      onConfirm={() => { closeAllWorkspaceTabs(); setCloseAllOpen(false); }}
      onCancel={() => setCloseAllOpen(false)}
    />
    </>
  );
}
