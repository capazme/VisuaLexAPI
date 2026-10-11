/**
 * The practice's table (spec `2026-10-08-norm-tab-container-design.md` T9). Off unless
 * `VITE_FEATURE_PRACTICE_TABLE` is exactly "true", unlike the house's flags, which are on by
 * default: those hide a finished area in a deployment, this one hides unfinished work on `develop`,
 * so a build that does not ask for it gets the old surface. Read at call time; P6 removes it.
 */
export function isPracticeTableEnabled(): boolean {
  return (import.meta.env as Record<string, string | undefined>).VITE_FEATURE_PRACTICE_TABLE === 'true';
}
