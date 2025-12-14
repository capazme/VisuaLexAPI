import { useState, useEffect, useCallback, useRef } from 'react';

interface EdgeState {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
}

interface UseEdgeHoverOptions {
  topThreshold?: number;
  bottomThreshold?: number;
  sideThreshold?: number;
  hideDelay?: number;
  enabled?: boolean;
}

interface UseEdgeHoverReturn {
  edges: EdgeState;
  isInsidePanel: {
    left: boolean;
    right: boolean;
  };
  setInsidePanel: (panel: 'left' | 'right', inside: boolean) => void;
  pinnedPanels: {
    left: boolean;
    right: boolean;
  };
  togglePinPanel: (panel: 'left' | 'right') => void;
}

export function useEdgeHover(options: UseEdgeHoverOptions = {}): UseEdgeHoverReturn {
  const {
    topThreshold = 40,
    bottomThreshold = 40,
    sideThreshold = 80,
    hideDelay = 300,
    enabled = true
  } = options;

  const [edges, setEdges] = useState<EdgeState>({
    top: false,
    bottom: false,
    left: false,
    right: false
  });

  const [isInsidePanel, setIsInsidePanelState] = useState({
    left: false,
    right: false
  });

  const [pinnedPanels, setPinnedPanels] = useState({
    left: false,
    right: false
  });

  const hideTimeouts = useRef<{
    top?: NodeJS.Timeout;
    bottom?: NodeJS.Timeout;
    left?: NodeJS.Timeout;
    right?: NodeJS.Timeout;
  }>({});

  const clearHideTimeout = useCallback((edge: keyof EdgeState) => {
    if (hideTimeouts.current[edge]) {
      clearTimeout(hideTimeouts.current[edge]);
      hideTimeouts.current[edge] = undefined;
    }
  }, []);

  const scheduleHide = useCallback((edge: keyof EdgeState) => {
    clearHideTimeout(edge);
    hideTimeouts.current[edge] = setTimeout(() => {
      setEdges(prev => ({ ...prev, [edge]: false }));
    }, hideDelay);
  }, [hideDelay, clearHideTimeout]);

  const setInsidePanel = useCallback((panel: 'left' | 'right', inside: boolean) => {
    setIsInsidePanelState(prev => ({ ...prev, [panel]: inside }));
  }, []);

  const togglePinPanel = useCallback((panel: 'left' | 'right') => {
    setPinnedPanels(prev => ({ ...prev, [panel]: !prev[panel] }));
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handleMouseMove = (e: MouseEvent) => {
      const { clientX, clientY } = e;
      const { innerWidth, innerHeight } = window;

      const newEdges = {
        top: clientY <= topThreshold,
        bottom: clientY >= innerHeight - bottomThreshold,
        left: clientX <= sideThreshold,
        right: clientX >= innerWidth - sideThreshold
      };

      // Handle top edge
      if (newEdges.top) {
        clearHideTimeout('top');
        setEdges(prev => ({ ...prev, top: true }));
      } else if (edges.top && !newEdges.top) {
        scheduleHide('top');
      }

      // Handle bottom edge
      if (newEdges.bottom) {
        clearHideTimeout('bottom');
        setEdges(prev => ({ ...prev, bottom: true }));
      } else if (edges.bottom && !newEdges.bottom) {
        scheduleHide('bottom');
      }

      // Handle left edge (consider panel hover and pinned state)
      if (newEdges.left || isInsidePanel.left) {
        clearHideTimeout('left');
        setEdges(prev => ({ ...prev, left: true }));
      } else if (edges.left && !newEdges.left && !isInsidePanel.left && !pinnedPanels.left) {
        scheduleHide('left');
      }

      // Handle right edge (consider panel hover and pinned state)
      if (newEdges.right || isInsidePanel.right) {
        clearHideTimeout('right');
        setEdges(prev => ({ ...prev, right: true }));
      } else if (edges.right && !newEdges.right && !isInsidePanel.right && !pinnedPanels.right) {
        scheduleHide('right');
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      // Clear all timeouts on cleanup
      Object.values(hideTimeouts.current).forEach(timeout => {
        if (timeout) clearTimeout(timeout);
      });
    };
  }, [
    enabled,
    topThreshold,
    bottomThreshold,
    sideThreshold,
    edges,
    isInsidePanel,
    pinnedPanels,
    clearHideTimeout,
    scheduleHide
  ]);

  // Keep pinned panels visible
  useEffect(() => {
    if (pinnedPanels.left) {
      setEdges(prev => ({ ...prev, left: true }));
    }
    if (pinnedPanels.right) {
      setEdges(prev => ({ ...prev, right: true }));
    }
  }, [pinnedPanels]);

  return {
    edges,
    isInsidePanel,
    setInsidePanel,
    pinnedPanels,
    togglePinPanel
  };
}
