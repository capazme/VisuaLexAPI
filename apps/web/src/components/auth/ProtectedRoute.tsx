/**
 * Protected route wrapper that requires authentication
 */
import { Navigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BookOpen } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  // Show premium branded loading state while checking authentication
  if (loading) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900 z-50">
        {/* Pulsing Logo with Blur Effect */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ repeat: Infinity, duration: 1.5, repeatType: 'reverse' }}
          className="mb-6 relative"
        >
          {/* Blur Background */}
          <div className="absolute inset-0 bg-blue-500 blur-xl opacity-20 rounded-full" />
          {/* Icon */}
          <BookOpen className="w-16 h-16 text-blue-600 relative z-10" />
        </motion.div>

        {/* Branded Text */}
        <div className="space-y-2 text-center">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">VisuaLex API</h3>
          <p className="text-sm text-slate-500 animate-pulse">Caricamento delle risorse in corso...</p>
        </div>
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
