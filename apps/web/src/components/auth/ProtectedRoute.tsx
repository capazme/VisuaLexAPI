/**
 * Protected route wrapper that requires authentication
 */
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { BookMark } from '../ui/BookMark';
import { LexCraftLogo } from '../ui/LexCraftLogo';
import { CONNECTION_FAILED_MESSAGE } from '../../services/api';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, loading, user, retrying } = useAuth();
  const location = useLocation();

  // While the session is checked: the column of the splash in index.html, at the same place and size, so
  // the hand-over from the splash to the app does not jump; it breathes instead of rising again.
  // The line under it is positioned apart, so the column does not move when it appears.
  if (loading) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-slate-50 text-primary-600 dark:bg-slate-950 dark:text-primary-400">
        <div role="status" aria-label="Caricamento di LexCraft" className="grid">
          <BookMark size={56} breathe />
        </div>
        {/* Always in the page, so a screen reader hears the words when they come (LC14). */}
        <p role="status" className="absolute inset-x-0 top-1/2 mt-12 px-4 text-center text-sm text-slate-600 dark:text-slate-300">
          {retrying ? 'Il server non risponde, riprovo…' : ''}
        </p>
      </div>
    );
  }

  // Redirect to login if not authenticated, preserving intended destination
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // The session is kept but the account could not be read (a 429, a 5xx, no answer, after the retries): said in
  // words, never a page drawn without its user (LC13).
  if (!user) return <SessionKeptUnreachable />;

  // Render children if authenticated
  return <>{children}</>;
}

/** Signed in, the account not read: the session stays open and a reload asks again. The still logo over the message
 *  (LC16): a screen without the shell still says whose it is. */
export function SessionKeptUnreachable() {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="flex max-w-sm flex-col items-center gap-6">
        <LexCraftLogo className="h-auto w-[160px]" />
        <div role="alert" className="text-center text-slate-700 dark:text-slate-200">
          <p className="mb-4">{CONNECTION_FAILED_MESSAGE}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-11 rounded-xl bg-primary-600 dark:bg-toga-400 dark:hover:bg-toga-300 dark:text-ink-950 px-6 font-medium text-white hover:bg-primary-700"
          >
            Riprova
          </button>
        </div>
      </div>
    </div>
  );
}
