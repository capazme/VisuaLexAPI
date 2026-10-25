import type { AiReviewState, AssistantNoteEntry, DossierItem, Highlight, Proposal } from '../types';

/** How many of the notes an application wrote on an entry or a block stand in each state (D7b; the server's `assistant_notes`). */
export interface AiReviewCounts {
  proposed: number;
  validated: number;
  review: number;
}

export function countAiReview(states: readonly AiReviewState[]): AiReviewCounts {
  const counts: AiReviewCounts = { proposed: 0, validated: 0, review: 0 };
  for (const state of states) counts[state]++;
  return counts;
}

/**
 * The row's traffic light: red if one item is «Da rivedere», else yellow if one is «da validare», else green once
 * all are validated; nothing when the application wrote nothing.
 */
export function aiReviewSignal(counts: AiReviewCounts): AiReviewState | null {
  if (counts.review > 0) return 'review';
  if (counts.proposed > 0) return 'proposed';
  if (counts.validated > 0) return 'validated';
  return null;
}

/** What the light says, on hover and to a screen reader: «2 da validare · 1 da rivedere · 1 validato». */
export function aiReviewSummary(counts: AiReviewCounts): string {
  const parts: string[] = [];
  if (counts.proposed > 0) parts.push(`${counts.proposed} da validare`);
  if (counts.review > 0) parts.push(`${counts.review} da rivedere`);
  if (counts.validated > 0) parts.push(`${counts.validated} ${counts.validated === 1 ? 'validato' : 'validati'}`);
  return parts.join(' · ');
}

/**
 * A proposal drawn as a highlight on its entry's text (D7b): its own id, the reader's keys, the words and offset the
 * server cut from the real text, and who proposed it with its note.
 */
export function proposalHighlight(p: Proposal, normaKey: string, articleId: string): Highlight {
  return {
    id: p.id, normaKey, articleId, rangeSerialized: '', text: p.text, color: p.color, startOffset: p.startOffset,
    proposal: { clientName: p.proposedBy?.clientName ?? null, note: p.note },
  };
}

type NoteItem = Extract<DossierItem, { type: 'note' }>;

/** A note entry with the state an application's note has (and the feature on: the server sends null otherwise). */
export const hasAssistantNote = (note: NoteItem): note is NoteItem & { assistantNote: AssistantNoteEntry } => !!note.assistantNote;
