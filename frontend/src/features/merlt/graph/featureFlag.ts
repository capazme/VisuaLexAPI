/**
 * Single source of truth for the MERL-T graph feature flag, used by the route
 * guard, the Sidebar entry, and the explorer page. Mirrors the registry's
 * default-ON semantics: absent env var = enabled; explicit "false"/"0"/"" = off.
 */
export function isMerltGraphEnabled(): boolean {
  const value = (import.meta.env as Record<string, string | undefined>).VITE_FEATURE_MERLT_GRAPH;
  if (value === undefined) return true;
  return value !== 'false' && value !== '0' && value !== '';
}
