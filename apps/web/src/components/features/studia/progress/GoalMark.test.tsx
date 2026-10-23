import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GoalMark } from './GoalMark';

describe('GoalMark (G9)', () => {
  it('is named «Obiettivo raggiunto» when given a name, and is decoration otherwise', () => {
    const { unmount } = render(<GoalMark size={112} label="Obiettivo raggiunto" />);
    expect(screen.getByRole('img', { name: 'Obiettivo raggiunto' })).toBeInTheDocument();
    unmount();
    render(<GoalMark size={32} />);
    expect(screen.getByTestId('goal-mark')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('draws three strokes — the ring, the tick, the line under it — each uncovered by its own pen, with no text', () => {
    render(<GoalMark size={112} />);
    const mark = screen.getByTestId('goal-mark');
    const strokes = [...mark.querySelectorAll(':scope > path')];
    const pens = [...mark.querySelectorAll('mask path')];
    expect(strokes).toHaveLength(3);
    expect(pens).toHaveLength(3);
    for (const [i, stroke] of strokes.entries()) {
      const mask = pens[i].closest('mask')!;
      expect(stroke.getAttribute('mask')).toBe(`url(#${mask.id})`);
      // An id a `url()` takes as it is: no punctuation from React's own.
      expect(mask.id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(pens[i]).toHaveAttribute('pathLength', '1');
      expect(pens[i]).toHaveClass('vlx-goal-mark-pen');
    }
    expect(mark.querySelectorAll('text')).toHaveLength(0);
  });

  it('writes itself only when asked, once: otherwise whole', () => {
    const { rerender } = render(<GoalMark size={112} draw />);
    expect(screen.getByTestId('goal-mark')).toHaveClass('vlx-goal-mark', 'vlx-goal-mark-draw');
    rerender(<GoalMark size={112} />);
    expect(screen.getByTestId('goal-mark')).not.toHaveClass('vlx-goal-mark-draw');
  });

  it('takes heavier strokes when small, so they do not thin to a hair', () => {
    const { unmount } = render(<GoalMark size={112} />);
    const large = screen.getByTestId('goal-mark').querySelector(':scope > path')!.getAttribute('d');
    unmount();
    render(<GoalMark size={32} />);
    const small = screen.getByTestId('goal-mark').querySelector(':scope > path')!.getAttribute('d');
    expect(small).not.toBe(large);
  });

  it('keeps two marks on one page apart: each its own masks', () => {
    render(<><GoalMark size={112} /><GoalMark size={32} /></>);
    const ids = [...document.querySelectorAll('mask')].map((mask) => mask.id);
    expect(new Set(ids).size).toBe(6);
  });
});
