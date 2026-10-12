import { useSyncExternalStore } from 'react';
import { isFindWindowScopedTo, subscribeFindWindowScope } from '../utils/findWindowControl';

/** Whether the find window is open and scoped to `tabId` («Questa pratica» on that practice) and, when
 *  `targetKey` is given, to that text: the magnifier's `aria-pressed`. A window pointed at another
 *  text of the same practice is not pressed here. False for a surface with no host. */
export function useFindWindowScopedTo(tabId: string | undefined, targetKey?: string): boolean {
  return useSyncExternalStore(
    subscribeFindWindowScope,
    () => isFindWindowScopedTo(tabId, targetKey),
    () => false,
  );
}
