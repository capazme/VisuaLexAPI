import { useState, useEffect } from 'react';
import { motion, useMotionValue, useSpring, useDragControls } from 'framer-motion';
import type { PanInfo } from 'framer-motion';
import { Search, Minimize2, Plus } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { SearchForm } from './SearchForm';
import type { SearchParams } from '../../../types';

interface FloatingSearchPanelProps {
  onSearch: (params: SearchParams) => void;
  isLoading: boolean;
}

// Spring physics config for smooth, natural motion
const SPRING_CONFIG = { damping: 30, stiffness: 300, mass: 0.8 };

export function FloatingSearchPanel({ onSearch, isLoading }: FloatingSearchPanelProps) {
  const {
    searchPanelState,
    toggleSearchPanel,
    setSearchPanelPosition,
    addWorkspaceTab
  } = useAppStore();

  const [showTooltip, setShowTooltip] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Drag controls for handle-based dragging
  const dragControls = useDragControls();

  // Motion values for smooth physics-based dragging
  const x = useMotionValue(searchPanelState.position.x);
  const y = useMotionValue(searchPanelState.position.y);

  // Apply spring physics to the motion values
  const springX = useSpring(x, SPRING_CONFIG);
  const springY = useSpring(y, SPRING_CONFIG);

  // Sync position from store when it changes externally
  useEffect(() => {
    if (!isDragging) {
      x.set(searchPanelState.position.x);
      y.set(searchPanelState.position.y);
    }
  }, [searchPanelState.position.x, searchPanelState.position.y, isDragging, x, y]);

  // Hide tooltip after 2 seconds
  useEffect(() => {
    if (showTooltip) {
      const timer = setTimeout(() => setShowTooltip(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [showTooltip]);

  const handleNewTab = () => {
    addWorkspaceTab('Nuova Tab');
  };

  const handleDragStart = () => {
    setIsDragging(true);
  };

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsDragging(false);

    // Get current position and apply momentum
    const currentX = x.get();
    const currentY = y.get();

    // Calculate final position with momentum (velocity * decay factor)
    const momentumX = info.velocity.x * 0.1;
    const momentumY = info.velocity.y * 0.1;

    // Clamp to window bounds
    const maxX = window.innerWidth - (searchPanelState.isCollapsed ? 56 : 384);
    const maxY = window.innerHeight - (searchPanelState.isCollapsed ? 56 : 200);

    const finalX = Math.max(0, Math.min(maxX, currentX + momentumX));
    const finalY = Math.max(0, Math.min(maxY, currentY + momentumY));

    // Animate to final position with spring physics
    x.set(finalX);
    y.set(finalY);

    // Save to store
    setSearchPanelPosition({ x: finalX, y: finalY });
  };

  const handleSingleClick = () => {
    setShowTooltip(true);
  };

  // Collapsed state: draggable FAB button
  if (searchPanelState.isCollapsed) {
    return (
      <motion.div
        drag
        dragMomentum={true}
        dragElastic={0.1}
        dragTransition={{ bounceStiffness: 300, bounceDamping: 20 }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        style={{ x: springX, y: springY }}
        className="fixed z-[9999] cursor-grab active:cursor-grabbing"
        whileDrag={{ scale: 1.05 }}
        whileHover={{ scale: 1.02 }}
      >
        <div className="relative">
          <button
            onClick={handleSingleClick}
            onDoubleClick={toggleSearchPanel}
            className="w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-colors"
            title="Doppio click per aprire - Trascinabile"
          >
            <Search size={24} />
          </button>

          {/* Tooltip on single click */}
          {showTooltip && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute left-1/2 -translate-x-1/2 -top-12 whitespace-nowrap bg-gray-900 text-white text-xs font-medium px-3 py-2 rounded-lg shadow-lg"
            >
              Doppio click per aprire
              <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 bg-gray-900 rotate-45" />
            </motion.div>
          )}
        </div>
      </motion.div>
    );
  }

  // Expanded state: draggable panel with SearchForm
  return (
    <motion.div
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={true}
      dragElastic={0.05}
      dragTransition={{ bounceStiffness: 400, bounceDamping: 25 }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      style={{ x: springX, y: springY }}
      className="fixed z-[9999]"
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 w-96 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header with drag handle */}
        <div
          onPointerDown={(e) => {
            // Only start drag if not clicking a button
            const target = e.target as HTMLElement;
            if (target.closest('button')) return;
            dragControls.start(e);
          }}
          className="h-12 flex items-center justify-between px-4 cursor-grab active:cursor-grabbing bg-gradient-to-b from-gray-50/50 to-transparent dark:from-gray-900/50 border-b border-gray-200 dark:border-gray-700 select-none touch-none"
        >
          {/* Grip Dots Indicator */}
          <div className="flex gap-1.5 opacity-30 hover:opacity-100 transition-opacity pointer-events-none">
            <div className="w-1 h-1 bg-gray-600 dark:bg-gray-400 rounded-full" />
            <div className="w-1 h-1 bg-gray-600 dark:bg-gray-400 rounded-full" />
            <div className="w-1 h-1 bg-gray-600 dark:bg-gray-400 rounded-full" />
          </div>

          {/* Title */}
          <span className="text-xs font-bold uppercase tracking-widest text-gray-400 pointer-events-none">Ricerca</span>

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
    </motion.div>
  );
}
