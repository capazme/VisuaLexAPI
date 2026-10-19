/**
 * Magnetic snap utility for floating panels
 * Snaps panels to screen edges and other panels when dragging
 */

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PanelBounds {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

const SNAP_THRESHOLD = 20; // pixels

/**
 * Calculate bounds for a panel
 */
export function getPanelBounds(
  id: string,
  position: Position,
  size: Size
): PanelBounds {
  return {
    id,
    left: position.x,
    right: position.x + size.width,
    top: position.y,
    bottom: position.y + size.height,
    centerX: position.x + size.width / 2,
    centerY: position.y + size.height / 2
  };
}

/**
 * Apply magnetic snap to screen edges and other panels
 */
export function applyMagneticSnap(
  currentPanelId: string,
  position: Position,
  size: Size,
  otherPanels: Array<{ id: string; position: Position; size: Size }>
): Position {
  let { x, y } = position;

  // Screen bounds
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  const currentBounds = getPanelBounds(currentPanelId, { x, y }, size);

  // Snap to screen edges
  // Left edge
  if (Math.abs(currentBounds.left) < SNAP_THRESHOLD) {
    x = 0;
  }

  // Right edge
  if (Math.abs(screenWidth - currentBounds.right) < SNAP_THRESHOLD) {
    x = screenWidth - size.width;
  }

  // Top edge
  if (Math.abs(currentBounds.top) < SNAP_THRESHOLD) {
    y = 0;
  }

  // Bottom edge
  if (Math.abs(screenHeight - currentBounds.bottom) < SNAP_THRESHOLD) {
    y = screenHeight - size.height;
  }

  // Snap to other panels
  for (const otherPanel of otherPanels) {
    if (otherPanel.id === currentPanelId) continue;

    const otherBounds = getPanelBounds(
      otherPanel.id,
      otherPanel.position,
      otherPanel.size
    );

    // Horizontal alignment checks
    const verticalOverlap =
      currentBounds.bottom > otherBounds.top &&
      currentBounds.top < otherBounds.bottom;

    if (verticalOverlap) {
      // Snap left edge to other's right edge
      if (Math.abs(currentBounds.left - otherBounds.right) < SNAP_THRESHOLD) {
        x = otherBounds.right;
      }

      // Snap right edge to other's left edge
      if (Math.abs(currentBounds.right - otherBounds.left) < SNAP_THRESHOLD) {
        x = otherBounds.left - size.width;
      }

      // Snap left edges together
      if (Math.abs(currentBounds.left - otherBounds.left) < SNAP_THRESHOLD) {
        x = otherBounds.left;
      }

      // Snap right edges together
      if (Math.abs(currentBounds.right - otherBounds.right) < SNAP_THRESHOLD) {
        x = otherBounds.right - size.width;
      }
    }

    // Vertical alignment checks
    const horizontalOverlap =
      currentBounds.right > otherBounds.left &&
      currentBounds.left < otherBounds.right;

    if (horizontalOverlap) {
      // Snap top edge to other's bottom edge
      if (Math.abs(currentBounds.top - otherBounds.bottom) < SNAP_THRESHOLD) {
        y = otherBounds.bottom;
      }

      // Snap bottom edge to other's top edge
      if (Math.abs(currentBounds.bottom - otherBounds.top) < SNAP_THRESHOLD) {
        y = otherBounds.top - size.height;
      }

      // Snap top edges together
      if (Math.abs(currentBounds.top - otherBounds.top) < SNAP_THRESHOLD) {
        y = otherBounds.top;
      }

      // Snap bottom edges together
      if (Math.abs(currentBounds.bottom - otherBounds.bottom) < SNAP_THRESHOLD) {
        y = otherBounds.bottom - size.height;
      }
    }

    // Center alignment
    // Horizontal center alignment
    if (
      verticalOverlap &&
      Math.abs(currentBounds.centerX - otherBounds.centerX) < SNAP_THRESHOLD
    ) {
      x = otherBounds.centerX - size.width / 2;
    }

    // Vertical center alignment
    if (
      horizontalOverlap &&
      Math.abs(currentBounds.centerY - otherBounds.centerY) < SNAP_THRESHOLD
    ) {
      y = otherBounds.centerY - size.height / 2;
    }
  }

  return { x, y };
}
