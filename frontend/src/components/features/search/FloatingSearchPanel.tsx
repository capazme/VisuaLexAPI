import { Rnd } from 'react-rnd';
import { Search, X, Pin, PinOff, Minimize2 } from 'lucide-react';
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
    setSearchPanelPosition
  } = useAppStore();

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
        style={{ zIndex: 50 }}
      >
        <button
          onClick={toggleSearchPanel}
          className="w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 cursor-pointer"
          title="Apri Ricerca (Cmd+K) - Draggable"
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
      style={{ zIndex: 50 }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 w-96 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header with drag handle */}
        <div className="drag-handle cursor-move flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <div className="flex items-center gap-2">
            <Search size={18} className="text-gray-600 dark:text-gray-400" />
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
              Ricerca Normativa
            </h3>
          </div>

          <div className="flex items-center gap-1">
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
