import { useForumSignalTracker } from './tracking/useForumSignalTracker';
import { ConsentBanner } from './consent/ConsentBanner';

/**
 * Global MERL-T slot mounted once in Layout via the `global` plugin slot.
 * Hosts trackers that must survive across page navigations and the non-blocking
 * first-run consent banner (Slice 2b), which needs a Layout-level mount so it
 * can appear regardless of the current route.
 */
export function GlobalMerltSlot() {
    useForumSignalTracker();
    return <ConsentBanner />;
}
