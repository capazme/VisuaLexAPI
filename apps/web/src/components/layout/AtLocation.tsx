import { useContext, useMemo, type ReactNode } from 'react';
import { UNSAFE_LocationContext, type Location } from 'react-router-dom';

/**
 * The address a page was drawn at, kept for it (LC84): `PageSlide` keeps the leaving page's element, whose route is its
 * own (`useOutlet`), but whatever in it reads `useLocation` (a title from the address, Opus's) would read the new one
 * and draw the coming page twice. The router has no public way to give a subtree its own location (`<Routes location>`
 * starts a new tree of routes), hence its context.
 */
export function AtLocation({ location, children }: { location: Location; children: ReactNode }) {
  const context = useContext(UNSAFE_LocationContext);
  const value = useMemo(() => ({ ...context, location }), [context, location]);
  return <UNSAFE_LocationContext.Provider value={value}>{children}</UNSAFE_LocationContext.Provider>;
}
