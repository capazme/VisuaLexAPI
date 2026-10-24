import { Component, Suspense, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { buttonClassName } from '../ui/buttonStyles';
import { cn } from '../../lib/utils';

interface BoundaryProps {
  pathname: string;
  children: ReactNode;
}

interface BoundaryState {
  failed: boolean;
  /** Where it failed: another address draws its page again. */
  at: string | null;
}

/**
 * A page whose code cannot be fetched (a connection that dropped, a file a deploy removed) or that fails while in use:
 * the layout stays, and the page's place says so with words the app already has, «Si è verificato un errore.» and
 * «Riprova», which reloads (what mends a file a deploy removed). On `develop` the whole app went blank.
 */
class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, at: null };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    return state.at !== null && state.at !== props.pathname ? { failed: false, at: null } : null;
  }

  componentDidCatch(error: unknown) {
    console.error('the page could not be shown', error);
    this.setState({ at: this.props.pathname });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-base text-slate-700 dark:text-slate-300">Si è verificato un errore.</p>
        <button type="button" onClick={() => window.location.reload()} className={cn(buttonClassName('primary', 'lg'), 'mt-2')}>
          Riprova
        </button>
      </div>
    );
  }
}

/**
 * Where a route's page is drawn (`Layout`'s outlet, the public «Crediti»): its code loaded with the route (`pageCode.ts`)
 * waits with nothing in its place, so nothing stays once it is there; a navigation keeps the page it leaves until the
 * new one is ready (the router renders it in a transition), and a failure is `Boundary`'s.
 */
export function RoutePage({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <Boundary pathname={pathname}>
      <Suspense fallback={null}>{children}</Suspense>
    </Boundary>
  );
}
