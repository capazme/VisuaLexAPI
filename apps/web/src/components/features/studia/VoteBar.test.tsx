import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VoteBar } from './VoteBar';

describe('VoteBar — the keyboard’s place', () => {
  it.each(['Migliorabile', 'Errata'])('gives the focus back to «%s» when the reason is taken back', async (label) => {
    render(<VoteBar cardId="c1" busy={false} onVote={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.getByRole('textbox', { name: 'Scrivi il motivo' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.getByRole('button', { name: label })).toHaveFocus();
  });

  it('leaves the focus alone when another card closes the reason field', async () => {
    const { rerender } = render(<VoteBar cardId="c1" busy={false} onVote={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Errata' }));
    rerender(<VoteBar cardId="c2" busy={false} onVote={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Errata' })).not.toHaveFocus();
  });
});
