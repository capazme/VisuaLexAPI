import { useForumSignalTracker } from './tracking/useForumSignalTracker';

/**
 * Global MERL-T slot mounted once in Layout via the `global` plugin slot.
 * Hosts trackers that must survive across page navigations — the forum
 * signal tracker is the only one for Slice 1, but future stories may
 * add e.g. search-performed tracking here.
 *
 * No props, no UI.
 */
export function GlobalMerltSlot() {
    useForumSignalTracker();
    return null;
}
