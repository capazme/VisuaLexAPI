import { useRef } from 'react';
import { Rnd } from 'react-rnd';
import { Search, X, Pin, PinOff, Minimize2, Plus } from 'lucide-react';
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

  // Track velocity for crazy ball inertia
  const lastPositions = useRef<Array<{ x: number; y: number; time: number }>>([]);

  const handleNewTab = () => {
    addWorkspaceTab('Nuova Tab');
  };

  const handleDrag = (_e: any, data: { x: number; y: number }) => {
    const now = Date.now();
    lastPositions.current.push({ x: data.x, y: data.y, time: now });
    if (lastPositions.current.length > 5) {
      lastPositions.current.shift();
    }
  };

  const handleDragStop = (_e: any, data: { x: number; y: number }) => {
    const positions = lastPositions.current;

    if (positions.length >= 2) {
      const last = positions[positions.length - 1];
      const prev = positions[0];
      const dt = (last.time - prev.time) / 1000;

      if (dt > 0 && dt < 0.3) {
        const vx = (last.x - prev.x) / dt;
        const vy = (last.y - prev.y) / dt;

        // Same as WorkspaceTab
        const friction = 0.25;
        const finalX = Math.round(data.x + vx * friction);
        const finalY = Math.round(data.y + vy * friction);

        // Clamp to window bounds
        const size = searchPanelState.isCollapsed ? 56 : 384;
        const height = searchPanelState.isCollapsed ? 56 : 400;
        const maxX = window.innerWidth - size;
        const maxY = window.innerHeight - height;

        setSearchPanelPosition({
          x: Math.max(0, Math.min(finalX, maxX)),
          y: Math.max(0, Math.min(finalY, maxY))
        });
      } else {
        setSearchPanelPosition({ x: data.x, y: data.y });
      }
    } else {
      setSearchPanelPosition({ x: data.x, y: data.y });
    }

    lastPositions.current = [];
  };

  // Collapsed state: draggable FAB button
  if (searchPanelState.isCollapsed) {
    return (
      <Rnd
        position={{ x: searchPanelState.position.x, y: searchPanelState.position.y }}
        onDrag={handleDrag}
        onDragStop={handleDragStop}
        enableResizing={false}
        bounds="window"
        className="z-50"
        style={{ zIndex: 50, transition: 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}
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
      onDrag={handleDrag}
      onDragStop={handleDragStop}
      enableResizing={false}
      dragHandleClassName="drag-handle"
      bounds="window"
      className="z-50"
      style={{ zIndex: 50, transition: 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}
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
