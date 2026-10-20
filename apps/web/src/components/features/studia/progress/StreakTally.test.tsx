import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StreakTally } from './StreakTally';

describe('StreakTally (S2)', () => {
  it('draws the bundle being filled: one mark a day, the stroke across the four on the fifth', () => {
    const { rerender, container } = render(<StreakTally count={3} grew={false} />);
    expect(screen.getByTestId('streak-tally')).toHaveAttribute('data-marks', '3');
    expect(container.querySelectorAll('g path')).toHaveLength(3);
    expect(screen.queryByTestId('streak-tally-stroke')).toBeNull();

    rerender(<StreakTally count={10} grew={false} />);
    expect(screen.getByTestId('streak-tally')).toHaveAttribute('data-marks', '5');
    expect(container.querySelectorAll('g path')).toHaveLength(4);
    expect(screen.getByTestId('streak-tally-stroke')).toBeInTheDocument();

    rerender(<StreakTally count={11} grew />);
    expect(screen.getByTestId('streak-tally')).toHaveAttribute('data-marks', '1');
  });

  it('draws nothing before the first day, and is hidden from a screen reader: the count says it', () => {
    const { container, rerender } = render(<StreakTally count={0} grew />);
    expect(container).toBeEmptyDOMElement();
    rerender(<StreakTally count={2} grew />);
    expect(screen.getByTestId('streak-tally')).toHaveAttribute('aria-hidden', 'true');
  });
});
