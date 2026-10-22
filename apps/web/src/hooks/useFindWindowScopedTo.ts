import { useSyncExternalStore } from 'react';
import { isFindWindowScopedTo, subscribeFindWindowScope } from '../utils/findWindowControl';

/** Whether the find window is open and scoped to `tabId` («Questa pratica» on that practice) and, when
 *  `targetKey` is given, to that text: the magnifier's `aria-pressed`. A window pointed at another
 *  text of the same practice is not pressed here. With `exact`, only the window pointed at that very text counts
 *  (the article's menu entry, R3: the window open on the practice with no text pointed at is not «on this text», and
 *  the entry points it here rather than close it). False for a surface with no host. */
export function useFindWindowScopedTo(tabId: string | undefined, targetKey?: string, exact = false): boolean {
  return useSyncExternalStore(
    subscribeFindWindowScope,
    () => isFindWindowScopedTo(tabId, targetKey, exact),
    () => false,
  );
}
