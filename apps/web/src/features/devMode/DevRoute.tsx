import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

/**
 * A route element for a development address: without the development mode the address is not
 * there, so it leads to the search page. While the account is still being read it draws nothing
 * (a reload on the address must not be mistaken for the mode being off).
 */
export function DevRoute({ children }: { children: ReactNode }) {
  const { loading, devMode } = useAuth();
  if (loading) return null;
  if (!devMode) return <Navigate to="/" replace />;
  return <>{children}</>;
}
