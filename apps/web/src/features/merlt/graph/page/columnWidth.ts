/**
 * Draggable-splitter width state for the docked deliberation column (audit
 * item 4). Kept in a non-component module so the clamp logic stays
 * unit-testable; the persistence key mirrors `merlt-grafo-column-collapsed`
 * (the existing collapse preference).
 */

export const COLUMN_WIDTH_MIN = 320;
export const COLUMN_WIDTH_MAX = 640;
export const COLUMN_WIDTH_DEFAULT = 400;
export const COLUMN_WIDTH_STORAGE_KEY = 'merlt-grafo-column-width';

/** Clamp a candidate column width into the sane drag range; NaN/Infinity → the default. */
export function clampColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return COLUMN_WIDTH_DEFAULT;
  return Math.min(COLUMN_WIDTH_MAX, Math.max(COLUMN_WIDTH_MIN, Math.round(width)));
}

/** Read the persisted width from localStorage, clamped; the default on any failure. */
export function readStoredColumnWidth(): number {
  try {
    const raw = localStorage.getItem(COLUMN_WIDTH_STORAGE_KEY);
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return clampColumnWidth(n);
  } catch {
    return COLUMN_WIDTH_DEFAULT;
  }
}
