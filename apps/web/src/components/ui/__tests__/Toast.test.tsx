import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { Toast } from '../Toast';

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    setHidden(false);
    vi.useRealTimers();
  });

  it('closes after its duration while the tab is on screen', () => {
    const onClose = vi.fn();
    render(<Toast message="Salvato" type="success" isVisible onClose={onClose} duration={3000} />);
    act(() => vi.advanceTimersByTime(2999));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('pauses while the tab is hidden and resumes with the time it had left', () => {
    const onClose = vi.fn();
    render(<Toast message="Salvato" type="success" isVisible onClose={onClose} duration={3000} />);
    act(() => vi.advanceTimersByTime(1000));
    act(() => setHidden(true));
    act(() => vi.advanceTimersByTime(60_000));
    expect(onClose).not.toHaveBeenCalled();

    act(() => setHidden(false));
    act(() => vi.advanceTimersByTime(1999));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('waits for the tab to show when it fires in a hidden one', () => {
    setHidden(true);
    const onClose = vi.fn();
    render(<Toast message="Salvato" type="success" isVisible onClose={onClose} duration={3000} />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(onClose).not.toHaveBeenCalled();
    act(() => setHidden(false));
    act(() => vi.advanceTimersByTime(3000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
