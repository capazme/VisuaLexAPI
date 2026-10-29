import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AiReviewSignal } from './AiReviewSignal';

describe('AiReviewSignal', () => {
  it.each([
    [{ proposed: 2, validated: 0, review: 1 }, 'review', 'lucide-flag', '2 da validare · 1 da rivedere'],
    [{ proposed: 1, validated: 2, review: 0 }, 'proposed', 'lucide-circle-dashed', '1 da validare · 2 validati'],
    [{ proposed: 0, validated: 3, review: 0 }, 'validated', 'lucide-circle-check', '3 validati'],
  ] as const)('%o: %s, its own shape, the counts in words', (counts, signal, shape, words) => {
    const { container } = render(<AiReviewSignal counts={counts} />);
    const light = container.querySelector<HTMLElement>('[data-ai-review]')!;
    expect(light.dataset.aiReview).toBe(signal);
    expect(light.querySelector('svg')?.classList.contains(shape)).toBe(true);
    expect(light).toHaveAttribute('title', words);
    expect(light.querySelector('.sr-only')?.textContent).toBe(words);
  });

  it('draws nothing when the application wrote nothing', () => {
    const { container } = render(<AiReviewSignal counts={{ proposed: 0, validated: 0, review: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
