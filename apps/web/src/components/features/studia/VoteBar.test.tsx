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

describe('VoteBar — three verdicts, the reason required', () => {
  it('draws the three verdicts alike, 44 px at every width: the interface does not lean', () => {
    render(<VoteBar cardId="c1" busy={false} onVote={vi.fn()} />);
    const verdicts = ['Approvata', 'Migliorabile', 'Errata'].map((name) => screen.getByRole('button', { name }));
    expect(new Set(verdicts.map((button) => button.className)).size).toBe(1);
    expect(verdicts[0]).toHaveClass('min-h-[44px]');
    expect(verdicts[0].className).not.toMatch(/\bmd:min-h-0\b/);
  });

  it('sends «Approvata» at once, and the others only with a reason written', async () => {
    const onVote = vi.fn();
    render(<VoteBar cardId="c1" busy={false} onVote={onVote} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approvata' }));
    expect(onVote).toHaveBeenLastCalledWith('APPROVATA');
    await userEvent.click(screen.getByRole('button', { name: 'Errata' }));
    const send = screen.getByRole('button', { name: 'Invia' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Scrivi il motivo' }), '   ');
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Scrivi il motivo' }), 'Cita l’articolo sbagliato.');
    await userEvent.click(send);
    expect(onVote).toHaveBeenLastCalledWith('ERRATA', 'Cita l’articolo sbagliato.');
  });
});
