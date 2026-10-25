import type { AiReviewState } from '../types';

/** How many of an entry's or a block's items an application wrote stand in each state (D7b). */
export interface AiReviewCounts {
  pending: number;
  validated: number;
  review: number;
}

export function countAiReview(states: readonly AiReviewState[]): AiReviewCounts {
  const counts: AiReviewCounts = { pending: 0, validated: 0, review: 0 };
  for (const state of states) counts[state]++;
  return counts;
}

/**
 * The row's traffic light: red if one item is «Da rivedere», else yellow if one is «da validare», else green once
 * all are validated; nothing when the application wrote nothing.
 */
export function aiReviewSignal(counts: AiReviewCounts): AiReviewState | null {
  if (counts.review > 0) return 'review';
  if (counts.pending > 0) return 'pending';
  if (counts.validated > 0) return 'validated';
  return null;
}

/** What the light says, on hover and to a screen reader: «2 da validare · 1 da rivedere · 1 validato». */
export function aiReviewSummary(counts: AiReviewCounts): string {
  const parts: string[] = [];
  if (counts.pending > 0) parts.push(`${counts.pending} da validare`);
  if (counts.review > 0) parts.push(`${counts.review} da rivedere`);
  if (counts.validated > 0) parts.push(`${counts.validated} ${counts.validated === 1 ? 'validato' : 'validati'}`);
  return parts.join(' · ');
}
