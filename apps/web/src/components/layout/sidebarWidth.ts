import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { guardedStorage } from '../../utils/guardedStorage';
import { useMediaQuery } from '../../hooks/useIsDesktop';

/** How the sidebar draws its entries: icons with a label on hover and focus, icons and words, or the phone's drawer. */
export type SidebarLayout = 'rail' | 'wide' | 'drawer';

/** The desktop column's widths, in px: the icon rail and the bar with words. */
export const SIDEBAR_RAIL_WIDTH = 64;
export const SIDEBAR_WIDE_WIDTH = 224;

/** Tailwind's `xl`: from here the desktop column can show its words. */
const WIDE_QUERY = '(min-width: 1280px)';

/**
 * Whether the user narrowed the bar to its icons on a large screen, kept in the browser (no account
 * setting: it is a matter of this screen). Wide by default. A write the browser refuses is logged and
 * the choice holds for the session.
 */
export const sidebarWidthStore = create<{ collapsed: boolean; toggle: () => void }>()(
  persist(
    (set) => ({
      collapsed: false,
      toggle: () => set((s) => ({ collapsed: !s.collapsed })),
    }),
    {
      name: 'visualex-sidebar',
      partialize: (s) => ({ collapsed: s.collapsed }),
      storage: createJSONStorage(() =>
        guardedStorage(localStorage, ({ error }) => console.warn('[sidebar] the width could not be saved in the browser', error)),
      ),
    },
  ),
);

/**
 * The desktop column's layout: from `xl` the bar with words unless the user narrowed it; between `lg`
 * and `xl` the icon rail, with no toggle (there is no room for words beside a reading row).
 */
export function useDesktopSidebar() {
  const roomForWords = useMediaQuery(WIDE_QUERY);
  const collapsed = sidebarWidthStore((s) => s.collapsed);
  const toggle = sidebarWidthStore((s) => s.toggle);
  const layout: SidebarLayout = roomForWords && !collapsed ? 'wide' : 'rail';
  return {
    layout,
    width: layout === 'wide' ? SIDEBAR_WIDE_WIDTH : SIDEBAR_RAIL_WIDTH,
    /** Offered only where the words fit. */
    toggle: roomForWords ? toggle : undefined,
  };
}
