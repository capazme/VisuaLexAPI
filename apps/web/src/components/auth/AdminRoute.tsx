/**
 * Admin route wrapper that requires admin privileges
 */
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { SessionKeptUnreachable, SessionLoading } from './ProtectedRoute';
import { LexCraftLogo } from '../ui/LexCraftLogo';

interface AdminRouteProps {
  children: React.ReactNode;
}

export function AdminRoute({ children }: AdminRouteProps) {
  const { isAuthenticated, isAdmin, loading, user, retrying } = useAuth();
  const location = useLocation();

  // While the session is checked: the same screen as every signed-in page, with its line while it retries (#463).
  if (loading) return <SessionLoading retrying={retrying} />;

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // The account not read (LC13): not taken for «not an administrator».
  if (!user) return <SessionKeptUnreachable />;

  // Show access denied if not admin
  if (!isAdmin) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4">
        <div className="max-w-md w-full text-center">
          {/* The still logo heads a screen without the shell (LC16). */}
          <LexCraftLogo className="mx-auto mb-8 block h-auto w-[160px]" />
          <div className="inline-flex items-center justify-center w-20 h-20 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full mb-6">
            <ShieldAlert size={40} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
            Accesso Negato
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mb-6">
            Non hai i permessi necessari per accedere a questa sezione.
            Contatta un amministratore se ritieni sia un errore.
          </p>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 dark:bg-toga-400 dark:hover:bg-toga-300 dark:text-ink-950 hover:bg-primary-700 text-white rounded-xl font-medium transition-colors"
          >
            Torna alla Home
          </a>
        </div>
      </div>
    );
  }

  // Render children if admin
  return <>{children}</>;
}
