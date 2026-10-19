/**
 * Authority-score helpers, kept out of the component file so ProfileCard.tsx
 * only exports its component (react-refresh/only-export-components boundary).
 */

/** Map authority (0..1) to a 3-star bucket (★☆☆ / ★★☆ / ★★★). */
export function authorityToStars(score: number): number {
  if (score >= 0.66) return 3;
  if (score >= 0.33) return 2;
  return 1;
}
