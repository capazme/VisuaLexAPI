import { useState } from 'react';
import {
  X,
  Maximize2,
  Minimize2,
  FileText,
  Folder,
  File,
  Eye,
  EyeOff,
  GripVertical,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type WorkspaceTab } from '../../../store/useAppStore';
import { cn } from '../../../lib/utils';

export interface SortableWorkspaceTabProps {
  tab: WorkspaceTab;
  isActive: boolean;
  onBringToFront: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleMinimize: (id: string) => void;
  onRemove: (id: string) => void;
}

function getTabSummary(tab: WorkspaceTab) {
  const normaCount = tab.content.filter(c => c.type === 'norma').length;
  const looseCount = tab.content.filter(c => c.type === 'loose-article').length;
  const collectionCount = tab.content.filter(c => c.type === 'collection').length;

  const parts: string[] = [];
  if (normaCount > 0) parts.push(`${normaCount} norma${normaCount > 1 ? 'e' : ''}`);
  if (looseCount > 0) parts.push(`${looseCount} articol${looseCount > 1 ? 'i' : 'o'}`);
  if (collectionCount > 0) parts.push(`${collectionCount} raccolt${collectionCount > 1 ? 'e' : 'a'}`);

  return parts.length > 0 ? parts.join(', ') : 'Vuota';
}

function getContentIcons(tab: WorkspaceTab) {
  const types = new Set(tab.content.map(c => c.type));
  return (
    <div className="flex gap-1">
      {types.has('norma') && <FileText size={10} className="text-primary-500" />}
      {types.has('loose-article') && <File size={10} className="text-amber-500" />}
      {types.has('collection') && <Folder size={10} className="text-purple-500" />}
    </div>
  );
}

function getArticleCount(tab: WorkspaceTab) {
  let count = 0;
  tab.content.forEach(item => {
    if (item.type === 'norma') {
      count += item.articles.length;
    } else if (item.type === 'loose-article') {
      count += 1;
    } else if (item.type === 'collection') {
      count += item.articles.length;
    }
  });
  return count;
}

/**
 * Single draggable tab-chip in the WorkspaceNavigator dock. Reorder is via a
 * dedicated drag-handle (not the whole chip) so click-to-bring-to-front and
 * drag-to-reorder don't fight over the same pointer events.
 */
export function SortableWorkspaceTab({
  tab,
  isActive,
  onBringToFront,
  onToggleVisibility,
  onToggleMinimize,
  onRemove,
}: SortableWorkspaceTabProps) {
  const [isHovered, setIsHovered] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative group flex flex-col min-w-[150px] max-w-[180px] p-3 rounded-xl border transition-all cursor-pointer select-none",
        isActive && !tab.isHidden
          ? "bg-primary-50/50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800 shadow-sm ring-1 ring-primary-500/10"
          : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md",
        tab.isHidden && "opacity-50 grayscale"
      )}
      onClick={() => onBringToFront(tab.id)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Tab header */}
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Trascina per riordinare la tab ${tab.label}`}
          className="text-slate-300 dark:text-slate-600 hover:text-slate-500 cursor-grab active:cursor-grabbing -ml-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
        >
          <GripVertical size={12} />
        </button>
        {tab.isHidden && (
          <EyeOff size={10} className="text-slate-400" />
        )}
        {tab.isMinimized && (
          <Minimize2 size={10} className="text-amber-500" />
        )}
        <span className={cn(
          "text-xs font-bold truncate flex-1",
          isActive ? "text-primary-700 dark:text-primary-300" : "text-slate-700 dark:text-slate-300"
        )}>
          {tab.label}
        </span>
        {getContentIcons(tab)}
      </div>

      {/* Content summary */}
      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate font-medium">
        {getTabSummary(tab)}
      </div>

      {/* Article count badge */}
      <div className={cn(
        "absolute -top-1.5 -right-1.5 min-w-[20px] h-[20px] flex items-center justify-center text-[10px] font-bold rounded-full px-1 shadow-sm border border-white dark:border-slate-800",
        isActive ? "bg-primary-600 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
      )}>
        {getArticleCount(tab)}
      </div>

      {/* Quick actions on hover */}
      {isHovered && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white dark:bg-slate-800 rounded-full shadow-lg border border-slate-200 dark:border-slate-700 p-1 animate-in fade-in zoom-in-95 duration-150 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisibility(tab.id);
            }}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-500 hover:text-primary-600"
            title={tab.isHidden ? "Mostra tab" : "Nascondi tab"}
          >
            {tab.isHidden ? (
              <EyeOff size={12} />
            ) : (
              <Eye size={12} />
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleMinimize(tab.id);
            }}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-500 hover:text-amber-600"
            title={tab.isMinimized ? "Espandi" : "Minimizza"}
          >
            {tab.isMinimized ? (
              <Maximize2 size={12} />
            ) : (
              <Minimize2 size={12} />
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(tab.id);
            }}
            className="p-1 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-full transition-colors text-slate-500 hover:text-red-500"
            title="Chiudi"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
