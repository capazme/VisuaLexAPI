/**
 * Admin route wrapper that requires admin privileges
 */
import { Navigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

interface AdminRouteProps {
  children: React.ReactNode;
}

export function AdminRoute({ children }: AdminRouteProps) {
  const { isAuthenticated, isAdmin, loading } = useAuth();
  const location = useLocation();

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900 z-50">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ repeat: Infinity, duration: 1.5, repeatType: 'reverse' }}
          className="mb-6 relative"
        >
          <div className="absolute inset-0 bg-amber-500 blur-xl opacity-20 rounded-full" />
          <ShieldAlert className="w-16 h-16 text-amber-600 relative z-10" />
        </motion.div>
        <div className="space-y-2 text-center">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">VisuaLex Admin</h3>
          <p className="text-sm text-slate-500 animate-pulse">Verifica autorizzazioni...</p>
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Show access denied if not admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4">
        <div className="max-w-md w-full text-center">
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
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors"
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
