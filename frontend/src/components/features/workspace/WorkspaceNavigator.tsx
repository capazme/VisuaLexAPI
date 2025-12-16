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
    toggleTabVisibility
  } = useAppStore();

  if (workspaceTabs.length === 0) return null;

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
      <div className="flex gap-0.5">
        {types.has('norma') && <FileText size={10} className="text-blue-500" />}
        {types.has('loose-article') && <File size={10} className="text-orange-500" />}
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
        "fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999]",
        className
      )}
    >
      {/* Collapsed toggle button */}
      {!isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <Layers size={16} className="text-blue-500" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {workspaceTabs.length} tab
          </span>
          <ChevronUp size={14} className="text-gray-400" />
        </button>
      )}

      {/* Expanded navigator */}
      {isExpanded && (
        <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
            <div className="flex items-center gap-2">
              <Layers size={14} className="text-blue-500" />
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                Workspace
              </span>
              <span className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full">
                {workspaceTabs.length}
              </span>
            </div>
            <button
              onClick={() => setIsExpanded(false)}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
            >
              <ChevronDown size={14} className="text-gray-400" />
            </button>
          </div>

          {/* Tab list */}
          <div className="flex gap-2 p-3 max-w-[90vw] overflow-x-auto no-scrollbar">
            {sortedTabs.map((tab, index) => (
              <div
                key={tab.id}
                className={cn(
                  "relative group flex flex-col min-w-[140px] max-w-[180px] p-2 rounded-xl border transition-all cursor-pointer",
                  index === 0 && !tab.isHidden
                    ? "bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 shadow-md"
                    : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md",
                  tab.isHidden && "opacity-50"
                )}
                onClick={() => bringTabToFront(tab.id)}
                onMouseEnter={() => setHoveredTab(tab.id)}
                onMouseLeave={() => setHoveredTab(null)}
              >
                {/* Tab header */}
                <div className="flex items-center gap-2 mb-1">
                  {tab.isHidden && (
                    <EyeOff size={10} className="text-gray-400" />
                  )}
                  {tab.isPinned && (
                    <Pin size={10} className="text-blue-500 fill-blue-500" />
                  )}
                  {tab.isMinimized && (
                    <Minimize2 size={10} className="text-yellow-500" />
                  )}
                  <span className={cn(
                    "text-xs font-semibold truncate flex-1",
                    index === 0 ? "text-blue-700 dark:text-blue-300" : "text-gray-700 dark:text-gray-300"
                  )}>
                    {tab.label}
                  </span>
                  {getContentIcons(tab)}
                </div>

                {/* Content summary */}
                <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                  {getTabSummary(tab)}
                </div>

                {/* Article count badge */}
                <div className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-blue-500 text-white text-[10px] font-bold rounded-full px-1">
                  {getArticleCount(tab)}
                </div>

                {/* Quick actions on hover */}
                {hoveredTab === tab.id && (
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white dark:bg-gray-800 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 p-1 animate-in fade-in zoom-in-95 duration-150">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTabVisibility(tab.id);
                      }}
                      className="p-1 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-full transition-colors"
                      title={tab.isHidden ? "Mostra tab" : "Nascondi tab"}
                    >
                      {tab.isHidden ? (
                        <EyeOff size={12} className="text-gray-400" />
                      ) : (
                        <Eye size={12} className="text-blue-500" />
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTabPin(tab.id);
                      }}
                      className="p-1 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-full transition-colors"
                      title={tab.isPinned ? "Rimuovi pin" : "Fissa"}
                    >
                      {tab.isPinned ? (
                        <PinOff size={12} className="text-blue-500" />
                      ) : (
                        <Pin size={12} className="text-gray-400" />
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTabMinimize(tab.id);
                      }}
                      className="p-1 hover:bg-yellow-100 dark:hover:bg-yellow-900/50 rounded-full transition-colors"
                      title={tab.isMinimized ? "Espandi" : "Minimizza"}
                    >
                      {tab.isMinimized ? (
                        <Maximize2 size={12} className="text-yellow-500" />
                      ) : (
                        <Minimize2 size={12} className="text-yellow-500" />
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTab(tab.id);
                      }}
                      className="p-1 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full transition-colors"
                      title="Chiudi"
                    >
                      <X size={12} className="text-red-500" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Keyboard hint */}
          <div className="px-4 py-1.5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              Click per portare in primo piano • Hover per azioni rapide
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
