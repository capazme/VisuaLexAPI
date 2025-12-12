import { Rnd } from 'react-rnd';
import { Search, X, Pin, PinOff, Minimize2, Plus, GripHorizontal } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { SearchForm } from './SearchForm';
import { cn } from '../../../lib/utils';
import type { SearchParams } from '../../../types';

interface FloatingSearchPanelProps {
  onSearch: (params: SearchParams) => void;
  isLoading: boolean;
}

export function FloatingSearchPanel({ onSearch, isLoading }: FloatingSearchPanelProps) {
  const {
    searchPanelState,
    toggleSearchPanel,
    setSearchPanelPosition,
    addWorkspaceTab
  } = useAppStore();

  const handleNewTab = () => {
    addWorkspaceTab('Nuova Tab');
  };

  const handleDragStop = (_e: any, data: { x: number; y: number }) => {
    setSearchPanelPosition({ x: data.x, y: data.y });
  };

  // Collapsed state: draggable FAB button
  if (searchPanelState.isCollapsed) {
    return (
      <Rnd
        position={{ x: searchPanelState.position.x, y: searchPanelState.position.y }}
        onDragStop={handleDragStop}
        enableResizing={false}
        bounds="window"
        className="z-50"
      >
        <button
          onDoubleClick={toggleSearchPanel}
          className="w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center cursor-pointer transition-transform hover:scale-110 active:scale-95"
          title="Doppio click per aprire - Trascinabile"
        >
          <Search size={24} />
        </button>
      </Rnd>
    );
  }

  // Expanded state: draggable panel with SearchForm
  return (
    <Rnd
      position={{ x: searchPanelState.position.x, y: searchPanelState.position.y }}
      onDragStop={handleDragStop}
      enableResizing={false}
      dragHandleClassName="drag-handle"
      bounds="window"
      className="z-50"
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 w-96 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header with drag handle and grip dots */}
        <div className="drag-handle h-12 flex items-center justify-between px-4 cursor-move bg-gradient-to-b from-gray-50/50 to-transparent dark:from-gray-900/50 border-b border-gray-200 dark:border-gray-700">
          {/* Grip Dots Indicator */}
          <div className="flex gap-1.5 opacity-30 hover:opacity-100 transition-opacity">
            <div className="w-1 h-1 bg-gray-600 dark:bg-gray-400 rounded-full" />
            <div className="w-1 h-1 bg-gray-600 dark:bg-gray-400 rounded-full" />
            <div className="w-1 h-1 bg-gray-600 dark:bg-gray-400 rounded-full" />
          </div>

          {/* Title */}
          <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Ricerca</span>

          <div className="flex items-center gap-1">
            <button
              onClick={handleNewTab}
              className="px-2 py-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors flex items-center gap-1"
              title="Crea nuova tab vuota"
            >
              <Plus size={16} className="text-gray-600 dark:text-gray-400" />
              <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">Tab</span>
            </button>
            <button
              onClick={toggleSearchPanel}
              className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
              title="Minimizza (Cmd+K)"
            >
              <Minimize2 size={16} className="text-gray-600 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* SearchForm content */}
        <div className="overflow-y-auto flex-1">
          <SearchForm onSearch={onSearch} isLoading={isLoading} />
        </div>
      </div>
    </Rnd>
  );
}
