/**
 * VisuaLex Studia feature flag. Mirrors the MERL-T flags' default-ON semantics:
 * absent env var = enabled; explicit "false"/"0"/"" = off.
 */
export function isStudiaEnabled(): boolean {
  const value = (import.meta.env as Record<string, string | undefined>).VITE_FEATURE_STUDIA;
  if (value === undefined) return true;
  return value !== 'false' && value !== '0' && value !== '';
}
