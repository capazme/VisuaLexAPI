import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FeedbackButton } from './FeedbackButton';

describe('FeedbackButton', () => {
  it('is the word «Commenti», 44 px tall, and takes the classes the layout places it with', () => {
    render(<FeedbackButton className="fixed max-md:hidden" onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Commenti' })).toHaveClass('h-11', 'fixed', 'max-md:hidden');
  });

  it('asks the layout to open the form, which it holds', () => {
    const onOpen = vi.fn();
    render(<FeedbackButton onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Commenti' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
