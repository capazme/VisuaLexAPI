/**
 * Whole-integration MERL-T feature flag. Mirrors the plugin registry's
 * default-ON semantics: absent env var = enabled; explicit "false"/"0"/"" = off.
 * (Graph-only UI has its own flag in graph/featureFlag.ts.)
 */
export function isMerltEnabled(): boolean {
  const value = (import.meta.env as Record<string, string | undefined>).VITE_FEATURE_MERLT;
  if (value === undefined) return true;
  return value !== 'false' && value !== '0' && value !== '';
}
