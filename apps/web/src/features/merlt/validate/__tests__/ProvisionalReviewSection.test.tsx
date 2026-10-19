import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProvisionalReviewSection } from '../ProvisionalReviewSection';
import type { ProvisionalReviewItem } from '../validateApi';

function item(overrides: Partial<ProvisionalReviewItem> = {}): ProvisionalReviewItem {
  return {
    node_id: 'live:abc',
    source_url: 'https://www.normattiva.it/uri-res/N2Ls?urn:x~art1',
    trust: 0.18,
    usage_count: 1,
    positive_feedback_count: 2,
    has_confirmed_citation: true,
    review_reason: 'faded_with_positive_signal',
    review_flagged_at: '2026-07-16T14:00:00+00:00',
    labels: ['Norma', 'LiveSource'],
    text_preview: 'Testo di prova',
    ...overrides,
  };
}

describe('ProvisionalReviewSection', () => {
  it('renders an empty state when there are no items', () => {
    render(<ProvisionalReviewSection items={[]} pending={new Set()} onAdjudicate={vi.fn()} />);
    expect(screen.getByText(/nessun nodo in attesa/i)).toBeInTheDocument();
  });

  it('renders a card with its signals and the domain label (not LiveSource)', () => {
    render(
      <ProvisionalReviewSection items={[item()]} pending={new Set()} onAdjudicate={vi.fn()} />,
    );
    expect(screen.getByText('Norma')).toBeInTheDocument();
    expect(screen.getByText(/usi: 1/)).toBeInTheDocument();
    expect(screen.getByText(/feedback\+: 2/)).toBeInTheDocument();
    expect(screen.getByText(/citato da confermati/)).toBeInTheDocument();
  });

  it('calls onAdjudicate with approve / reject on the buttons', () => {
    const onAdjudicate = vi.fn();
    render(
      <ProvisionalReviewSection items={[item()]} pending={new Set()} onAdjudicate={onAdjudicate} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /conferma/i }));
    expect(onAdjudicate).toHaveBeenCalledWith('live:abc', 'approve');
    fireEvent.click(screen.getByRole('button', { name: /rimuovi/i }));
    expect(onAdjudicate).toHaveBeenCalledWith('live:abc', 'reject');
  });

  it('disables the buttons while the node is being adjudicated', () => {
    render(
      <ProvisionalReviewSection
        items={[item()]}
        pending={new Set(['live:abc'])}
        onAdjudicate={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /conferma/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /rimuovi/i })).toBeDisabled();
  });
});
