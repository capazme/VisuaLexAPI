import { useSyncExternalStore } from 'react';
import { getFindWindowScope, subscribeFindWindowScope } from '../utils/findWindowControl';

/** Whether the find window is open and scoped to `tabId` («Questa scheda» on that tab): the
 *  magnifier's `aria-pressed`. False for a surface with no tab. */
export function useFindWindowScopedTo(tabId: string | undefined): boolean {
  const scoped = useSyncExternalStore(subscribeFindWindowScope, getFindWindowScope, () => null);
  return tabId !== undefined && scoped === tabId;
}
