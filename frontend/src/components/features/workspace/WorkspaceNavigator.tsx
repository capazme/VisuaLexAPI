import { useState } from 'react';
import {
  Layers,
  X,
  Pin,
  PinOff,
  Maximize2,
  Minimize2,
  FileText,
  Folder,
  File,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff
} from 'lucide-react';
import { useAppStore, type WorkspaceTab } from '../../../store/useAppStore';
import { cn } from '../../../lib/utils';
import { useCompare } from '../../../hooks/useCompare';
import { Z_INDEX } from '../../../constants/zIndex';

interface WorkspaceNavigatorProps {
  className?: string;
}

/**
 * Global workspace navigator showing all open tabs.
 * Provides quick access to switch between tabs, preview content, and manage tabs.
 */
export function WorkspaceNavigator({ className }: WorkspaceNavigatorProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);

  const {
    workspaceTabs,
    bringTabToFront,
    removeTab,
    toggleTabPin,
    toggleTabMinimize,
    toggleTabVisibility,
    commandPaletteOpen,
  } = useAppStore();

  // Check if compare view is open
  const { isOpen: isCompareOpen } = useCompare();

  // Hide dock when heavy overlays are active
  const shouldHide = isCompareOpen || commandPaletteOpen;

  if (workspaceTabs.length === 0 || shouldHide) return null;

  // Sort by zIndex (most recent on top)
  const sortedTabs = [...workspaceTabs].sort((a, b) => b.zIndex - a.zIndex);

  // Get content summary for a tab
  const getTabSummary = (tab: WorkspaceTab) => {
    const normaCount = tab.content.filter(c => c.type === 'norma').length;
    const looseCount = tab.content.filter(c => c.type === 'loose-article').length;
    const collectionCount = tab.content.filter(c => c.type === 'collection').length;

    const parts: string[] = [];
    if (normaCount > 0) parts.push(`${normaCount} norma${normaCount > 1 ? 'e' : ''}`);
    if (looseCount > 0) parts.push(`${looseCount} articol${looseCount > 1 ? 'i' : 'o'}`);
    if (collectionCount > 0) parts.push(`${collectionCount} raccolt${collectionCount > 1 ? 'e' : 'a'}`);

    return parts.length > 0 ? parts.join(', ') : 'Vuota';
  };

  // Get content icons for a tab
  const getContentIcons = (tab: WorkspaceTab) => {
    const types = new Set(tab.content.map(c => c.type));
    return (
      <div className="flex gap-1">
        {types.has('norma') && <FileText size={10} className="text-primary-500" />}
        {types.has('loose-article') && <File size={10} className="text-amber-500" />}
        {types.has('collection') && <Folder size={10} className="text-purple-500" />}
      </div>
    );
  };

  // Get article count for a tab
  const getArticleCount = (tab: WorkspaceTab) => {
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
  };

  return (
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
            <button
              onClick={() => setIsExpanded(false)}
              className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              <ChevronDown size={14} className="text-slate-400" />
            </button>
          </div>

          {/* Tab list */}
          <div className="flex gap-3 p-4 max-w-[90vw] overflow-x-auto custom-scrollbar">
            {sortedTabs.map((tab, index) => (
              <div
                key={tab.id}
                className={cn(
                  "relative group flex flex-col min-w-[150px] max-w-[180px] p-3 rounded-xl border transition-all cursor-pointer select-none",
                  index === 0 && !tab.isHidden
                    ? "bg-primary-50/50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800 shadow-sm ring-1 ring-primary-500/10"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-md",
                  tab.isHidden && "opacity-50 grayscale"
                )}
                onClick={() => bringTabToFront(tab.id)}
                onMouseEnter={() => setHoveredTab(tab.id)}
                onMouseLeave={() => setHoveredTab(null)}
              >
                {/* Tab header */}
                <div className="flex items-center gap-2 mb-2">
                  {tab.isHidden && (
                    <EyeOff size={10} className="text-slate-400" />
                  )}
                  {tab.isPinned && (
                    <Pin size={10} className="text-primary-500 fill-primary-500" />
                  )}
                  {tab.isMinimized && (
                    <Minimize2 size={10} className="text-amber-500" />
                  )}
                  <span className={cn(
                    "text-xs font-bold truncate flex-1",
                    index === 0 ? "text-primary-700 dark:text-primary-300" : "text-slate-700 dark:text-slate-300"
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
                  index === 0 ? "bg-primary-600 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                )}>
                  {getArticleCount(tab)}
                </div>

                {/* Quick actions on hover */}
                {hoveredTab === tab.id && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white dark:bg-slate-800 rounded-full shadow-lg border border-slate-200 dark:border-slate-700 p-1 animate-in fade-in zoom-in-95 duration-150 z-10">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTabVisibility(tab.id);
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
                        toggleTabPin(tab.id);
                      }}
                      className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-500 hover:text-primary-600"
                      title={tab.isPinned ? "Rimuovi pin" : "Fissa"}
                    >
                      {tab.isPinned ? (
                        <PinOff size={12} />
                      ) : (
                        <Pin size={12} />
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTabMinimize(tab.id);
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
                        removeTab(tab.id);
                      }}
                      className="p-1 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-full transition-colors text-slate-500 hover:text-red-500"
                      title="Chiudi"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Keyboard hint */}
          <div className="px-4 py-1.5 border-t border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
              Click per portare in primo piano • Drag per riordinare (coming soon)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
