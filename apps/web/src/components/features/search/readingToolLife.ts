import { useEffect } from 'react';
import { appStore, type ReadingTool } from '../../../store/useAppStore';
import { readInkSelection, type InkSelection } from '../../../utils/inkTargets';

/** Bars holding each tool's button now: when the last leaves the screen nobody is left to see the tool on. */
const mounted: Record<ReadingTool, number> = { highlight: 0, note: 0 };

/**
 * The words selected as a press on a tool's button starts (a press may take the selection away before its click), and
 * the words its menu's choice goes to, read as the menu opens. One gesture at a time, whichever bar and tool it is in.
 */
let selectionAtPress: InkSelection | null = null;
let selectionForMenu: InkSelection | null = null;

/** Called as a press on a tool's button (or its menu's arrow) starts. */
export const readAtPress = () => {
  selectionAtPress = readInkSelection();
  // Forgotten once the press is over, in the next task (after its click): a press dragged off the button, or a touch
  // that became a scroll, brings no click, and a later press from the keyboard reads the selection as it is then.
  const forget = () => {
    window.removeEventListener('pointerup', forget, true);
    window.removeEventListener('pointercancel', forget, true);
    window.setTimeout(() => { selectionAtPress = null; }, 0);
  };
  window.addEventListener('pointerup', forget, true);
  window.addEventListener('pointercancel', forget, true);
};

/** The words the press found, or (from the keyboard) the words selected now; null when none. */
export const takeAtPress = () => {
  const selected = selectionAtPress ?? readInkSelection();
  selectionAtPress = null;
  return selected;
};

/** As the menu opens: what its choice will go to. */
export const keepForMenu = () => { selectionForMenu = takeAtPress(); };
export const takeForMenu = () => {
  const selected = selectionForMenu;
  selectionForMenu = null;
  return selected;
};

/**
 * A tool's life (A4): Esc turns it off — unless the key belongs to what has the focus (a field, a menu, a dialog, a
 * popover) or a modal dialog is open — before anything else hears it (Study Mode's Esc, the lesson's); and it goes off
 * when the last bar that holds its button leaves the screen.
 */
export function useReadingToolLife(tool: ReadingTool, on: boolean, turnOff: () => void) {
  useEffect(() => {
    mounted[tool] += 1;
    return () => {
      mounted[tool] -= 1;
      // A microtask: the bar mounted again at once (StrictMode, a bar redrawn in the same commit) keeps it on.
      queueMicrotask(() => {
        if (mounted[tool] === 0 && appStore.getState().readingTool === tool) appStore.getState().setReadingTool(null);
      });
    };
  }, [tool]);
  useEffect(() => {
    if (!on) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const target = event.target;
      // What has an Esc of its own: a field, a menu, a dialog or a popover, the find window, a notification.
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="dialog"], [role="listbox"], [role="combobox"], [role="search"], [data-floating-tool], [data-notification-id]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      turnOff();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [on, turnOff]);
}
