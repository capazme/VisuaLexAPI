import { useEffect, type RefObject } from 'react';
import { registerFindRoot } from '../utils/findTargets';

/**
 * Registers the element `elementRef` points to as a find target's text root for as long as this
 * component is mounted with a `tabId` (a reading surface outside the workspace — a search preview,
 * a dossier reader — has none, and registers nothing: there is no tab to bring to front or search
 * «Tutte le schede» against). The registry's own display check (`findRootsFor`) decides whether the
 * root currently counts; this hook only keeps the registration in step with mount, unmount and a
 * change of identity (`targetKey`).
 */
export function useRegisterFindRoot(
  tabId: string | undefined,
  targetKey: string,
  label: string,
  elementRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!tabId) return;
    const element = elementRef.current;
    if (!element) return;
    return registerFindRoot({ tabId, targetKey, label, element });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- elementRef is a ref: its identity is stable, and its `.current` is read once per run, after the DOM commit that set it.
  }, [tabId, targetKey, label]);
}
