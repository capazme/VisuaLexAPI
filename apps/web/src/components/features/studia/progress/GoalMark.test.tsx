import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GoalMark } from './GoalMark';
import { writesInMasks } from './goalMarkMotion';

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

  it('writes itself in masks except on WebKit (Safari, every iPhone and iPad browser), where it fades in whole', () => {
    const ua = (userAgent: string, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints });
    const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    const EDGE = `${CHROME} Edg/130.0.0.0`;
    const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';
    const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
    expect([CHROME, EDGE, FIREFOX].map((agent) => writesInMasks(ua(agent)))).toEqual([true, true, true]);
    expect(writesInMasks(ua(SAFARI))).toBe(false);
    expect(writesInMasks(ua(IPHONE_CHROME))).toBe(false);
    // An iPad asking for the desktop site: a Mac's agent, with touch points.
    expect(writesInMasks(ua(SAFARI, 5))).toBe(false);
  });

  it('fades in whole where masks are not written (WebKit)', () => {
    const agent = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    try {
      render(<GoalMark size={112} draw />);
      const mark = screen.getByTestId('goal-mark');
      expect(mark).toHaveClass('vlx-goal-mark-fade');
      expect(mark).not.toHaveClass('vlx-goal-mark-draw');
    } finally {
      delete (navigator as unknown as Record<string, unknown>).userAgent;
      if (agent) Object.defineProperty(Navigator.prototype, 'userAgent', agent);
    }
  });
});
