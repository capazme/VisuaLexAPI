import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FeedbackModal } from './FeedbackModal';

vi.mock('../../services/feedbackService', () => ({ submitFeedback: vi.fn() }));

describe('FeedbackModal', () => {
  it('names the type group «Tipo di commento»', () => {
    render(<FeedbackModal isOpen onClose={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Tipo di commento' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Bug', 'Suggerimento', 'Altro']);
    expect(screen.queryByText('Tipo di feedback')).not.toBeInTheDocument();
  });

  // jsdom cannot measure: the classes are the check. At 390 px the three buttons were 22 px too wide
  // for the dialog; sized by their content and free to wrap, they never scroll it sideways.
  it('lets the three type buttons wrap instead of overflowing a narrow dialog', () => {
    render(<FeedbackModal isOpen onClose={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Tipo di commento' });
    expect(group).toHaveClass('flex-wrap');
    for (const button of within(group).getAllByRole('button')) expect(button).toHaveClass('flex-auto');
  });

  it('tells a screen reader which type is chosen', () => {
    render(<FeedbackModal isOpen onClose={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Tipo di commento' });
    const pressed = () => within(group).getAllByRole('button').map((b) => b.getAttribute('aria-pressed'));
    expect(pressed()).toEqual(['false', 'true', 'false']);
    fireEvent.click(within(group).getByRole('button', { name: 'Bug' }));
    expect(pressed()).toEqual(['true', 'false', 'false']);
  });
});
