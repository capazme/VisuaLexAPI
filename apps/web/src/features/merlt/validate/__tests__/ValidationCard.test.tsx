import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ValidationCard, type ValidationCardModel } from '../ValidationCard';

const baseItem: ValidationCardModel = {
  id: 'e1',
  title: 'Buona fede',
  body: 'Principio generale',
  fonte: 'llm_extraction',
  contributedBy: 'user-42',
  createdAt: '2026-06-30T10:00:00.000Z',
  votes: 3,
  normRef: 'urn:nir:stato:codice.civile:1942-03-16;262~art1375',
};

function renderCard(overrides: Partial<ValidationCardModel> = {}) {
  const onVote = vi.fn();
  const onSkip = vi.fn();
  const onOpenNorm = vi.fn();
  render(
    <ul>
      <ValidationCard
        item={{ ...baseItem, ...overrides }}
        onVote={onVote}
        onSkip={onSkip}
        onOpenNorm={onOpenNorm}
      />
    </ul>,
  );
  return { onVote, onSkip, onOpenNorm };
}

describe('ValidationCard', () => {
  it('renders the provenance line (pipeline + contributor + votes)', () => {
    renderCard();
    expect(screen.getByTestId('provenance-fonte')).toHaveTextContent(/automatica/i);
    expect(screen.getByText(/da user-42/)).toBeInTheDocument();
    expect(screen.getByText(/3 voti/)).toBeInTheDocument();
  });

  it('hides the contributor chip when contributor is unknown', () => {
    renderCard({ contributedBy: 'unknown' });
    expect(screen.queryByText(/da unknown/)).not.toBeInTheDocument();
  });

  it('opens the source norm with parsed SearchParams', () => {
    const { onOpenNorm } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: /apri la norma/i }));
    expect(onOpenNorm).toHaveBeenCalledTimes(1);
    expect(onOpenNorm).toHaveBeenCalledWith(
      expect.objectContaining({ act_type: 'codice civile', article: '1375' }),
    );
  });

  it('does not render the norm link when there is no parseable reference', () => {
    renderCard({ normRef: 'user_document' });
    expect(screen.queryByRole('button', { name: /apri la norma/i })).not.toBeInTheDocument();
  });

  it('votes approve on the thumbs-up (no reason)', () => {
    const { onVote } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: /approva buona fede/i }));
    expect(onVote).toHaveBeenCalledWith('e1', 'approve');
  });

  it('one-tap reject sends a reject vote with no reason', () => {
    const { onVote } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: /^rifiuta buona fede$/i }));
    expect(onVote).toHaveBeenCalledWith('e1', 'reject', undefined);
  });

  it('reject with a quick-reason forwards the reason', () => {
    const { onVote } = renderCard();
    // reasons panel is collapsed by default
    expect(screen.queryByTestId('reject-reasons')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /motivo del rifiuto/i }));
    expect(screen.getByTestId('reject-reasons')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /errore di pipeline/i }));
    expect(onVote).toHaveBeenCalledWith('e1', 'reject', 'errore di pipeline');
  });

  it('skip defers without voting', () => {
    const { onSkip, onVote } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: /salta buona fede/i }));
    expect(onSkip).toHaveBeenCalledWith('e1');
    expect(onVote).not.toHaveBeenCalled();
  });
});
