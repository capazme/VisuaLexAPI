import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentWordmark } from '../SegmentWordmark';
import { DONE_AT } from '../segments';

// framer-motion reads the preference once for the whole run: the hook is what the component asks.
const motionPref = vi.hoisted(() => ({ reduced: false }));
vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => motionPref.reduced,
}));

afterEach(() => {
  motionPref.reduced = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SegmentWordmark — the sign-in page\'s wordmark (A2)', () => {
  it('is the heading «VisuaLex» throughout; the display and the melting copy are hidden from a screen reader', () => {
    vi.useFakeTimers();
    render(<SegmentWordmark className="text-5xl" />);
    expect(screen.getByRole('heading', { level: 1, name: 'VisuaLex' })).toBeInTheDocument();
    const svg = document.querySelector('h1 svg');
    expect(svg).toHaveAttribute('aria-hidden');
    expect(svg?.querySelectorAll('line')).toHaveLength(8 * 7);
  });

  it('plays once: the display goes when the melt ends, and the page is told the wordmark is there', () => {
    vi.useFakeTimers();
    const onSettled = vi.fn();
    render(<SegmentWordmark className="text-5xl" onSettled={onSettled} />);
    expect(onSettled).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(DONE_AT + 10); });
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(document.querySelector('h1 svg')).toBeNull();
    act(() => { vi.advanceTimersByTime(10000); });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('a click on it plays it again, once it has ended', () => {
    vi.useFakeTimers();
    render(<SegmentWordmark className="text-5xl" />);
    fireEvent.click(screen.getByRole('heading', { level: 1 }));
    act(() => { vi.advanceTimersByTime(DONE_AT + 10); });
    expect(document.querySelector('h1 svg')).toBeNull();
    fireEvent.click(screen.getByRole('heading', { level: 1 }));
    expect(document.querySelector('h1 svg')).not.toBeNull();
  });

  it('under reduced motion draws no display: the wordmark only fades in', () => {
    motionPref.reduced = true;
    const onSettled = vi.fn();
    render(<SegmentWordmark className="text-5xl" onSettled={onSettled} />);
    expect(document.querySelector('h1 svg')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'VisuaLex' })).toBeInTheDocument();
    expect(onSettled).toHaveBeenCalled();
  });
});
