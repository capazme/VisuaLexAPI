import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FeedbackButton } from './FeedbackButton';

describe('FeedbackButton', () => {
  it('takes the classes it is handed on its fixed wrapper, so the layout can hide it below a breakpoint', () => {
    const { container } = render(<FeedbackButton className="max-md:hidden" onOpen={vi.fn()} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveClass('fixed', 'max-md:hidden');
  });

  it('asks the layout to open the form, which it holds', () => {
    const onOpen = vi.fn();
    render(<FeedbackButton onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Invia feedback' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
