import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useArticleViewedTracker } from '../useArticleViewedTracker';

// ---- Module mocks (must be hoisted above imports of mocked modules) ----
const sendEventMock = vi.fn().mockResolvedValue({ trace_id: 'trace-mock' });
const hasConsentMock = vi.fn().mockReturnValue(true);

vi.mock('../../../../services/merltService', () => ({
  sendArticleViewedEvent: (...args: unknown[]) => sendEventMock(...args),
}));

vi.mock('../../merltConsent', () => ({
  hasMerltConsent: () => hasConsentMock(),
}));

// ---- IntersectionObserver mock ----
type IOCallback = (entries: IntersectionObserverEntry[]) => void;
let lastIOCallback: IOCallback | null = null;
class MockIntersectionObserver {
  callback: IOCallback;
  constructor(callback: IOCallback) {
    this.callback = callback;
    lastIOCallback = callback;
  }
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}
beforeEach(() => {
  sendEventMock.mockClear();
  hasConsentMock.mockClear();
  hasConsentMock.mockReturnValue(true);
  lastIOCallback = null;
  // @ts-expect-error mock injection
  global.IntersectionObserver = MockIntersectionObserver;
});

function triggerVisible(isVisible: boolean): void {
  if (!lastIOCallback) return;
  lastIOCallback([
    {
      isIntersecting: isVisible,
      intersectionRatio: isVisible ? 1 : 0,
    } as IntersectionObserverEntry,
  ]);
}

/** Helper: render hook with a container ref pointing to a real div. */
function renderTrackerHook(opts: {
  articleUrn?: string;
  disabled?: boolean;
  normaVisitataId?: string;
}) {
  const container = document.createElement('div');
  Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 200, configurable: true });
  Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true });
  document.body.appendChild(container);

  const { unmount } = renderHook(() => {
    const ref = useRef<HTMLElement | null>(container);
    useArticleViewedTracker({
      articleUrn: opts.articleUrn ?? 'urn:nir~art2043',
      normaVisitataId: opts.normaVisitataId,
      containerRef: ref,
      sessionId: '11111111-1111-1111-1111-111111111111',
      disabled: opts.disabled,
    });
    return null;
  });

  return {
    container,
    unmount: () => {
      unmount();
      document.body.removeChild(container);
    },
  };
}

describe('useArticleViewedTracker', () => {
  it('does not emit immediately on mount', () => {
    const { unmount } = renderTrackerHook({});
    expect(sendEventMock).not.toHaveBeenCalled();
    unmount();
  });

  it('emits on unmount when dwell threshold (3000ms) is met', () => {
    vi.useFakeTimers();
    const t0 = 1_000_000;
    vi.setSystemTime(t0);
    const perfSpy = vi.spyOn(performance, 'now');
    perfSpy.mockReturnValue(0);

    const { unmount } = renderTrackerHook({});

    // Step 1: visible
    perfSpy.mockReturnValue(0);
    act(() => triggerVisible(true));

    // Step 2: 4s later, become invisible
    perfSpy.mockReturnValue(4000);
    act(() => triggerVisible(false));

    // Step 3: unmount triggers emit
    perfSpy.mockReturnValue(4000);
    unmount();

    expect(sendEventMock).toHaveBeenCalledTimes(1);
    expect(sendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        articleUrn: 'urn:nir~art2043',
        dwellMs: 4000,
        sessionId: '11111111-1111-1111-1111-111111111111',
      })
    );

    perfSpy.mockRestore();
    vi.useRealTimers();
  });

  it('does NOT emit when dwell < threshold AND no scroll', () => {
    const perfSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { unmount } = renderTrackerHook({});

    perfSpy.mockReturnValue(0);
    act(() => triggerVisible(true));
    perfSpy.mockReturnValue(1500); // only 1.5s
    act(() => triggerVisible(false));

    unmount();

    expect(sendEventMock).not.toHaveBeenCalled();
    perfSpy.mockRestore();
  });

  it('emits when scroll threshold (30%) is met even with short dwell', () => {
    const perfSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { container, unmount } = renderTrackerHook({});

    // Simulate scroll to 40% (scrollTop=320, scrollHeight=1000, clientHeight=200 → max=800)
    Object.defineProperty(container, 'scrollTop', { value: 320, configurable: true });
    container.dispatchEvent(new Event('scroll'));

    // Short dwell only
    act(() => triggerVisible(true));
    perfSpy.mockReturnValue(500);
    act(() => triggerVisible(false));

    unmount();

    expect(sendEventMock).toHaveBeenCalledTimes(1);
    const payload = sendEventMock.mock.calls[0][0];
    expect(payload.scrollMaxPct).toBeGreaterThanOrEqual(30);
    expect(payload.scrollMaxPct).toBeLessThanOrEqual(45);
    perfSpy.mockRestore();
  });

  it('does NOT emit when articleUrn is undefined', () => {
    const { unmount } = renderTrackerHook({ articleUrn: '' });
    act(() => triggerVisible(true));
    unmount();
    expect(sendEventMock).not.toHaveBeenCalled();
  });

  it('does NOT emit when consent is missing', () => {
    hasConsentMock.mockReturnValue(false);
    const { unmount } = renderTrackerHook({});
    act(() => triggerVisible(true));
    unmount();
    expect(sendEventMock).not.toHaveBeenCalled();
  });

  it('does NOT emit when disabled=true', () => {
    const { unmount } = renderTrackerHook({ disabled: true });
    act(() => triggerVisible(true));
    unmount();
    expect(sendEventMock).not.toHaveBeenCalled();
  });

  it('passes normaVisitataId through to the event payload', () => {
    const perfSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { unmount } = renderTrackerHook({
      normaVisitataId: '22222222-2222-2222-2222-222222222222',
    });

    perfSpy.mockReturnValue(0);
    act(() => triggerVisible(true));
    perfSpy.mockReturnValue(5000);
    act(() => triggerVisible(false));
    unmount();

    expect(sendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        normaVisitataId: '22222222-2222-2222-2222-222222222222',
      })
    );
    perfSpy.mockRestore();
  });
});
