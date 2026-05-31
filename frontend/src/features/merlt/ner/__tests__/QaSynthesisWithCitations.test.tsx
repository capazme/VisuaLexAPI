import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QaSynthesisWithCitations } from '../QaSynthesisWithCitations';

const TEXT = 'La risoluzione per inadempimento è disciplinata dall’art. 1453 c.c. e seguenti.';

describe('QaSynthesisWithCitations (surface: qa_chip)', () => {
  it('renders plain text (no markers) when disabled', () => {
    render(<QaSynthesisWithCitations text={TEXT} enabled={false} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /citazione:/i })).toBeNull();
    expect(screen.getByText(/La risoluzione per inadempimento/)).toBeInTheDocument();
  });

  it('marks detected citations as interactive buttons when enabled', () => {
    render(<QaSynthesisWithCitations text={TEXT} enabled onSubmit={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /citazione:/i }).length).toBeGreaterThan(0);
  });

  it('clicking a citation opens the NER feedback affordance and emits a qa_chip payload', () => {
    const onSubmit = vi.fn();
    render(<QaSynthesisWithCitations text={TEXT} enabled onSubmit={onSubmit} />);

    fireEvent.click(screen.getAllByRole('button', { name: /citazione:/i })[0]);
    // feedback bar appears
    const confirm = screen.getByRole('button', { name: /conferma la citazione/i });
    fireEvent.click(confirm);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.surface).toBe('qa_chip');
    expect(payload.feedbackType).toBe('confirmation');
    expect(typeof payload.contextWindow).toBe('string');
    expect(payload.contextWindow).toContain('1453');
  });
});
