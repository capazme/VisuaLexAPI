import { useEffect, useRef, type RefObject } from 'react';
import { registerFindRoot } from '../utils/findTargets';

interface Registered {
  element: HTMLElement;
  tabId: string;
  targetKey: string;
  label: string;
  unregister: () => void;
}

/**
 * Registers the element `elementRef` points to as a find target's text root for as long as it is
 * there and this component has a `tabId` (a reading surface outside the workspace — a search
 * preview, a dossier reader — has none, and registers nothing: there is no tab to bring to front or
 * search «Tutte le schede» against). The registry's own display check (`findRootsFor`) decides
 * whether the root currently counts; this hook only keeps the registration in step with the
 * element itself.
 *
 * The element is read after every commit of the owner, not once at mount: a text root mounts later
 * than its surface (an article whose text is shown only once its version allows it, gotcha 32) or is
 * replaced, and each of those follows a render of the owner that decides it. The registration it
 * holds is the element's, so a new element is registered and the old one removed (the registry
 * notifies the find window of both).
 */
export function useRegisterFindRoot(
  tabId: string | undefined,
  targetKey: string,
  label: string,
  elementRef: RefObject<HTMLElement | null>,
): void {
  const registered = useRef<Registered | null>(null);

  // No dependency list on purpose: the ref's `.current` can change on any commit, and comparing it
  // here is cheap; nothing is registered again while element and identity stay the same.
  useEffect(() => {
    const element = elementRef.current;
    const held = registered.current;
    if (
      held &&
      held.element === element &&
      held.tabId === tabId &&
      held.targetKey === targetKey &&
      held.label === label
    ) {
      return;
    }
    held?.unregister();
    registered.current = null;
    if (!tabId || !element) return;
    registered.current = { element, tabId, targetKey, label, unregister: registerFindRoot({ tabId, targetKey, label, element }) };
  });

  // Unmounted (and StrictMode's simulated unmount, gotcha 14: the effect above registers again on
  // the re-run, `registered` being empty).
  useEffect(
    () => () => {
      registered.current?.unregister();
      registered.current = null;
    },
    [],
  );
}
