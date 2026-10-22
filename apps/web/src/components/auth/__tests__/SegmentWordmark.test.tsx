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
    render(<SegmentWordmark className="text-5xl" weightClass="font-medium" />);
    expect(screen.getByRole('heading', { level: 1, name: 'VisuaLex' })).toBeInTheDocument();
    const svg = document.querySelector('h1 svg');
    expect(svg).toHaveAttribute('aria-hidden');
    expect(svg?.querySelectorAll('line')).toHaveLength(8 * 7);
  });

  it('plays once: the display goes when the melt ends, and the page is told the wordmark is there', () => {
    vi.useFakeTimers();
    const onSettled = vi.fn();
    render(<SegmentWordmark className="text-5xl" weightClass="font-medium" onSettled={onSettled} />);
    expect(onSettled).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(DONE_AT + 10); });
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(document.querySelector('h1 svg')).toBeNull();
    act(() => { vi.advanceTimersByTime(10000); });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('holds the real wordmark\'s box from the first frame, and hides the melting copies from a screen reader', () => {
    vi.useFakeTimers();
    render(<SegmentWordmark className="text-5xl" weightClass="font-medium" />);
    const h1 = screen.getByRole('heading', { level: 1 });
    const spans = [...h1.querySelectorAll(':scope > span')];
    // The real one, in the flow, and the two copies laid over it.
    expect(spans[0]).toHaveTextContent('VisuaLex');
    expect(spans[0]).not.toHaveAttribute('aria-hidden');
    expect(spans.slice(1).every((span) => span.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(spans[2]).toHaveClass('font-medium');
  });

  it('a click on it plays it again, once it has ended, never while it runs', () => {
    vi.useFakeTimers();
    const onSettled = vi.fn();
    render(<SegmentWordmark className="text-5xl" weightClass="font-medium" onSettled={onSettled} />);
    fireEvent.click(screen.getByRole('heading', { level: 1 }));
    act(() => { vi.advanceTimersByTime(DONE_AT + 10); });
    // The click during the run restarted nothing: it ended on time, once.
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(document.querySelector('h1 svg')).toBeNull();
    fireEvent.click(screen.getByRole('heading', { level: 1 }));
    expect(document.querySelector('h1 svg')).not.toBeNull();
  });

  it('under reduced motion draws no display: the wordmark only fades in', () => {
    motionPref.reduced = true;
    const onSettled = vi.fn();
    render(<SegmentWordmark className="text-5xl" weightClass="font-medium" onSettled={onSettled} />);
    expect(document.querySelector('h1 svg')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'VisuaLex' })).toBeInTheDocument();
    expect(onSettled).toHaveBeenCalled();
  });
});
