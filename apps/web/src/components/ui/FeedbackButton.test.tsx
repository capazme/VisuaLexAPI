import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./FeedbackModal', () => ({ FeedbackModal: () => null }));

import { FeedbackButton } from './FeedbackButton';

describe('FeedbackButton', () => {
  it('takes the classes it is handed on its fixed wrapper, so a page can hide it below a breakpoint', () => {
    const { container } = render(<FeedbackButton className="hidden md:block" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveClass('fixed', 'hidden', 'md:block');
  });
});
