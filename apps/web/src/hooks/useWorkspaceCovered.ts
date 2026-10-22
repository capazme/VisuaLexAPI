import { useEffect, useState } from 'react';
import { isWorkspaceCovered } from '../utils/findWindowControl';

/**
 * Whether an overlay covers the workspace (`isWorkspaceCovered`: a modal dialog, or a `data-find-overlay`), kept up
 * to date while `enabled`: the notifications' «· Ctrl+Z» is not written where the key would do nothing. Watched only
 * while asked; a MutationObserver hands its changes over once per task, so a burst of them is read once.
 */
export function useWorkspaceCovered(enabled: boolean): boolean {
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const read = () => setCovered(isWorkspaceCovered());
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-modal', 'data-find-overlay'] });
    return () => observer.disconnect();
  }, [enabled]);
  return enabled && covered;
}
