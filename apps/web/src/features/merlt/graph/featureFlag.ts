import { isMerltEnabled } from '../featureFlag';

/**
 * Single source of truth for the MERL-T graph feature flag, used by the route
 * guard, the Sidebar entry, and the explorer page. Mirrors the registry's
 * default-ON semantics: absent env var = enabled; explicit "false"/"0"/"" = off.
 * The graph is part of MERL-T (its routes sit under /api/merlt, which the
 * server's master switch 404s), so it is off whenever MERL-T is.
 */
export function isMerltGraphEnabled(): boolean {
  if (!isMerltEnabled()) return false;
  const value = (import.meta.env as Record<string, string | undefined>).VITE_FEATURE_MERLT_GRAPH;
  if (value === undefined) return true;
  return value !== 'false' && value !== '0' && value !== '';
}
