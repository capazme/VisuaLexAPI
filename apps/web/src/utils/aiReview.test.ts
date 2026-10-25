import { describe, it, expect } from 'vitest';
import { aiReviewSignal, aiReviewSummary, countAiReview } from './aiReview';

describe('the review of what an application wrote (D7b)', () => {
  it('counts each state', () => {
    expect(countAiReview(['pending', 'review', 'pending', 'validated'])).toEqual({ pending: 2, validated: 1, review: 1 });
    expect(countAiReview([])).toEqual({ pending: 0, validated: 0, review: 0 });
  });

  it('lights red for one to review, else yellow for one to validate, else green; nothing for nothing', () => {
    expect(aiReviewSignal({ pending: 3, validated: 2, review: 1 })).toBe('review');
    expect(aiReviewSignal({ pending: 1, validated: 5, review: 0 })).toBe('pending');
    expect(aiReviewSignal({ pending: 0, validated: 2, review: 0 })).toBe('validated');
    expect(aiReviewSignal({ pending: 0, validated: 0, review: 0 })).toBeNull();
  });

  it('says it in words, the open ones first', () => {
    expect(aiReviewSummary({ pending: 2, validated: 0, review: 1 })).toBe('2 da validare · 1 da rivedere');
    expect(aiReviewSummary({ pending: 0, validated: 1, review: 0 })).toBe('1 validato');
    expect(aiReviewSummary({ pending: 1, validated: 3, review: 0 })).toBe('1 da validare · 3 validati');
  });
});
