import { useEffect, useState } from 'react';
import { isWorkspaceCovered } from '../utils/findWindowControl';

/**
 * Whether an overlay covers the workspace (`isWorkspaceCovered`: a modal dialog, or a `data-find-overlay`), kept up
 * to date while `enabled`: the notifications' «· Ctrl+Z» is not written where the key would do nothing. Watched only
 * while asked; a MutationObserver hands its changes over once per task, so a burst of them is read once. `isCovered`
 * reads it another way (`isUndoCovered`: Study Mode leaves the undo seen).
 */
export function useWorkspaceCovered(enabled: boolean, isCovered: () => boolean = isWorkspaceCovered): boolean {
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const read = () => setCovered(isCovered());
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-modal', 'data-find-overlay', 'data-undo-through'] });
    return () => observer.disconnect();
  }, [enabled, isCovered]);
  return enabled && covered;
}
