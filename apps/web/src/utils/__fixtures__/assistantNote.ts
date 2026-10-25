import type { AiReviewState, AssistantNote } from '../../types';

/** An application's note on a passage, as the server's contract gives it (D7b), untouched unless `over` says so. */
export const aiNote = (text: string, state: AiReviewState = 'proposed', over: Partial<AssistantNote> = {}): AssistantNote => ({
  text, assistantText: text, state, stateChangedAt: null, reviewComment: null, edited: false, editedAt: null, editedBy: null, ...over,
});
