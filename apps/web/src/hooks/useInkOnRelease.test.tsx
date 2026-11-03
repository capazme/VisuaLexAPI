import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useRef } from 'react';
import { TOUCH_SETTLE_MS, useInkOnRelease } from './useInkOnRelease';

function Text({ active, onRelease }: { active: boolean; onRelease: (s: Selection) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useInkOnRelease(ref, active, onRelease);
  return <div ref={ref} data-testid="text"><p>Il danno ingiusto obbliga al risarcimento.</p></div>;
}

const select = (root: HTMLElement, from: number, to: number) => {
  const node = root.querySelector('p')!.firstChild!;
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, to);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
};
const press = (root: HTMLElement, pointerType: string) => {
  const event = new Event('pointerdown', { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  root.dispatchEvent(event);
};

afterEach(() => {
  vi.useRealTimers();
  window.getSelection()?.removeAllRanges();
});

describe('useInkOnRelease — when the tool takes a selection (A4)', () => {
  it('a mouse: at the release, and only with words selected', () => {
    vi.useFakeTimers();
    const onRelease = vi.fn();
    const { getByTestId } = render(<Text active onRelease={onRelease} />);
    const root = getByTestId('text');
    press(root, 'mouse');
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    vi.advanceTimersByTime(20);
    expect(onRelease).not.toHaveBeenCalled();
    select(root, 3, 8);
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    vi.advanceTimersByTime(20);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('a finger: once the selection has stood still, not at the long press\'s release', () => {
    vi.useFakeTimers();
    const onRelease = vi.fn();
    const { getByTestId } = render(<Text active onRelease={onRelease} />);
    const root = getByTestId('text');
    press(root, 'touch');
    select(root, 3, 8);
    document.dispatchEvent(new Event('selectionchange'));
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    vi.advanceTimersByTime(TOUCH_SETTLE_MS - 100);
    // The handles move it on: the wait starts again.
    select(root, 3, 17);
    document.dispatchEvent(new Event('selectionchange'));
    vi.advanceTimersByTime(TOUCH_SETTLE_MS - 100);
    expect(onRelease).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onRelease.mock.calls[0][0].toString()).toBe('danno ingiusto');
  });

  it('a finger still on the glass keeps it waiting; lifted, the wait starts again from there', () => {
    vi.useFakeTimers();
    const onRelease = vi.fn();
    const { getByTestId } = render(<Text active onRelease={onRelease} />);
    const root = getByTestId('text');
    document.dispatchEvent(new Event('touchstart'));
    press(root, 'touch');
    select(root, 3, 8);
    document.dispatchEvent(new Event('selectionchange'));
    vi.advanceTimersByTime(TOUCH_SETTLE_MS * 3);
    expect(onRelease).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('touchend'));
    vi.advanceTimersByTime(TOUCH_SETTLE_MS - 1);
    expect(onRelease).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('off, nothing is taken', () => {
    vi.useFakeTimers();
    const onRelease = vi.fn();
    const { getByTestId } = render(<Text active={false} onRelease={onRelease} />);
    const root = getByTestId('text');
    select(root, 3, 8);
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    vi.advanceTimersByTime(TOUCH_SETTLE_MS * 2);
    expect(onRelease).not.toHaveBeenCalled();
  });
});
