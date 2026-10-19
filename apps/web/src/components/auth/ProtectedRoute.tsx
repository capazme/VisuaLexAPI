/**
 * Protected route wrapper that requires authentication
 */
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { BookMark } from '../ui/BookMark';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  // While the session is checked: the book of the splash in index.html, at the same place and size, so
  // the hand-over from the splash to the app does not jump; it breathes instead of tracing again.
  if (loading) {
    return (
      <div role="status" aria-label="Caricamento di VisuaLex" className="fixed inset-0 z-50 grid place-items-center bg-slate-50 text-primary-600 dark:bg-slate-950 dark:text-primary-400">
        <BookMark size={56} breathe />
      </div>
    );
  }

  // Redirect to login if not authenticated, preserving intended destination
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Render children if authenticated
  return <>{children}</>;
}
