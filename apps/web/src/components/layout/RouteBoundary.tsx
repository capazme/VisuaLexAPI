import { Component, Suspense, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { buttonClassName } from '../ui/buttonStyles';
import { cn } from '../../lib/utils';

interface BoundaryProps {
  /** The navigation's key (`useLocation().key`): any new one draws the page again, the same address with another
   *  query or chosen again from the sidebar included. */
  navigation: string;
  children: ReactNode;
}

interface BoundaryState {
  failed: boolean;
  /** The navigation it failed in: another one draws its page again. */
  at: string | null;
}

/**
 * A page whose code cannot be fetched (a connection that dropped, a file a deploy removed) or that fails while in use:
 * the layout stays, and the page's place says so with words the app already has, «Si è verificato un errore.» and
 * «Riprova», which reloads (what mends a file a deploy removed). Before P1 no boundary held it, and the app went blank.
 */
class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, at: null };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    return state.at !== null && state.at !== props.navigation ? { failed: false, at: null } : null;
  }

  componentDidCatch(error: unknown) {
    console.error('the page could not be shown', error);
    this.setState({ at: this.props.navigation });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-base text-slate-700 dark:text-slate-300">Si è verificato un errore.</p>
        <button type="button" onClick={() => window.location.reload()} className={cn(buttonClassName('primary', 'lg'), 'mt-2')}>
          Riprova
        </button>
      </div>
    );
  }
}

/** A page's failure kept to its place (`Boundary`), for the navigation it failed in. */
export function PageBoundary({ children }: { children: ReactNode }) {
  const { key } = useLocation();
  return <Boundary navigation={key}>{children}</Boundary>;
}

/**
 * Where the layout draws a route's page (`Layout`'s outlet): its code loaded with the route (`pageCode.ts`) waits with
 * nothing in its place, so nothing stays once it is there; a navigation keeps the page it leaves until the new one is
 * ready (the router renders it in a transition, and this boundary is already on screen); a failure is `Boundary`'s.
 */
export function RoutePage({ children }: { children: ReactNode }) {
  return (
    <PageBoundary>
      <Suspense fallback={null}>{children}</Suspense>
    </PageBoundary>
  );
}
