import { useAuth } from '../../hooks/useAuth';

/**
 * Whether the development mode is on for the signed-in account: allowed by the administrator and
 * switched on by the account. It hides entries and pages (the MERL-T surfaces still in testing)
 * and never replaces a permission; the server's guards stay the real barrier.
 */
export function useDevMode(): boolean {
  return useAuth().devMode;
}
