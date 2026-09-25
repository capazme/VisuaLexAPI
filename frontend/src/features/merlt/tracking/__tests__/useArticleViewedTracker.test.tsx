import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useArticleViewedTracker } from '../useArticleViewedTracker';

// ---- Module mocks (must be hoisted above imports of mocked modules) ----
const sendEventMock = vi.fn().mockResolvedValue({ trace_id: 'trace-mock' });
const hasConsentMock = vi.fn().mockReturnValue(true);
const publishMock = vi.fn();

vi.mock('../../../../services/merltService', () => ({
  sendArticleViewedEvent: (...args: unknown[]) => sendEventMock(...args),
}));

vi.mock('../../consent/useConsent', () => ({
  useConsent: () => ({ canTrack: hasConsentMock() }),
}));

vi.mock('../../merltEventBus', () => ({
  publishMerltEvent: (...args: unknown[]) => publishMock(...args),
  // Mirror the real constant so the assertion checks the exact wire value.
  MERLT_EVENT_TYPES: { articleViewed: 'article_viewed' },
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
  publishMock.mockClear();
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

  it('emits when the article is revealed ≥30% inside its scrolling column, even with short dwell', () => {
    // The real layout: a non-scrolling article inside a scrolling reading
    // column. The tracker must measure the reveal of the article, not the
    // (always zero) scrollTop of the article itself.
    const perfSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    const column = document.createElement('div');
    column.style.overflowY = 'auto';
    Object.defineProperty(column, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(column, 'clientHeight', { value: 600, configurable: true });
    column.getBoundingClientRect = () =>
      ({ top: 0, bottom: 600, height: 600, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const article = document.createElement('div');
    let articleTop = 0;
    article.getBoundingClientRect = () =>
      ({ top: articleTop, bottom: articleTop + 1500, height: 1500, left: 0, right: 0, width: 0, x: 0, y: articleTop, toJSON: () => ({}) }) as DOMRect;
    column.appendChild(article);
    document.body.appendChild(column);

    const { unmount } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(article);
      useArticleViewedTracker({
        articleUrn: 'urn:nir~art2043',
        containerRef: ref,
        sessionId: '11111111-1111-1111-1111-111111111111',
      });
      return null;
    });

    // Scroll the column so that 1000px of the 1500px article have passed the
    // column's bottom edge: 66% revealed.
    articleTop = -400;
    column.dispatchEvent(new Event('scroll'));

    act(() => triggerVisible(true));
    perfSpy.mockReturnValue(500);
    act(() => triggerVisible(false));

    unmount();
    document.body.removeChild(column);

    expect(sendEventMock).toHaveBeenCalledTimes(1);
    const payload = sendEventMock.mock.calls[0][0];
    expect(payload.scrollMaxPct).toBeGreaterThanOrEqual(60);
    expect(payload.scrollMaxPct).toBeLessThanOrEqual(70);
    perfSpy.mockRestore();
  });

  it('counts a tall article as visible when its visible band fills half the viewport', () => {
    const perfSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { unmount } = renderTrackerHook({});

    act(() => {
      lastIOCallback?.([
        {
          isIntersecting: true,
          intersectionRatio: 0.3, // <50% of a very tall article on screen…
          intersectionRect: { height: 600 } as DOMRectReadOnly,
          rootBounds: { height: 600 } as DOMRectReadOnly, // …but it fills the viewport
        } as IntersectionObserverEntry,
      ]);
    });
    perfSpy.mockReturnValue(3500);
    act(() => triggerVisible(false));

    unmount();

    expect(sendEventMock).toHaveBeenCalledTimes(1);
    expect(sendEventMock.mock.calls[0][0].dwellMs).toBeGreaterThanOrEqual(3000);
    perfSpy.mockRestore();
  });

  it('keeps the scrollTop ratio for an article panel that scrolls by itself', () => {
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

  it('does NOT emit if consent is revoked mid-read (before unmount)', () => {
    const perfSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true });
    document.body.appendChild(container);
    const ref = { current: container as HTMLElement | null };

    const { rerender, unmount } = renderHook(() =>
      useArticleViewedTracker({
        articleUrn: 'urn:nir~art2043',
        containerRef: ref,
        sessionId: '11111111-1111-1111-1111-111111111111',
      }),
    );

    // Meet the dwell threshold while consent is still granted.
    perfSpy.mockReturnValue(0);
    act(() => triggerVisible(true));
    perfSpy.mockReturnValue(4000);
    act(() => triggerVisible(false));

    // Revoke consent and re-render so the ref-sync effect flips the live value.
    hasConsentMock.mockReturnValue(false);
    act(() => rerender());

    unmount();
    document.body.removeChild(container);

    expect(sendEventMock).not.toHaveBeenCalled();
    perfSpy.mockRestore();
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

  describe('bus publish for ConsentBanner (Slice 3 §3.2)', () => {
    it('publishes article_viewed on the bus for a genuine view', () => {
      const perfSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
      const { unmount } = renderTrackerHook({});

      perfSpy.mockReturnValue(0);
      act(() => triggerVisible(true));
      perfSpy.mockReturnValue(4000);
      act(() => triggerVisible(false));
      unmount();

      expect(publishMock).toHaveBeenCalledTimes(1);
      expect(publishMock).toHaveBeenCalledWith(
        expect.objectContaining({
          interaction_type: 'article_viewed',
          article_urn: 'urn:nir~art2043',
        })
      );
      perfSpy.mockRestore();
    });

    it('publishes on the bus even for a consent-none (read-only) user, while suppressing the POST', () => {
      // The banner is FOR read-only users — the bus publish must NOT be
      // consent-gated, but the BFF POST must stay gated.
      hasConsentMock.mockReturnValue(false);
      const perfSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
      const { unmount } = renderTrackerHook({});

      perfSpy.mockReturnValue(0);
      act(() => triggerVisible(true));
      perfSpy.mockReturnValue(4000);
      act(() => triggerVisible(false));
      unmount();

      expect(publishMock).toHaveBeenCalledTimes(1);
      expect(publishMock).toHaveBeenCalledWith(
        expect.objectContaining({ interaction_type: 'article_viewed' })
      );
      // POST stays consent-gated.
      expect(sendEventMock).not.toHaveBeenCalled();
      perfSpy.mockRestore();
    });

    it('does NOT publish on the bus when the view is not genuine (short dwell, no scroll)', () => {
      const perfSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
      const { unmount } = renderTrackerHook({});

      perfSpy.mockReturnValue(0);
      act(() => triggerVisible(true));
      perfSpy.mockReturnValue(1500); // 1.5s < 3s and no scroll
      act(() => triggerVisible(false));
      unmount();

      expect(publishMock).not.toHaveBeenCalled();
      perfSpy.mockRestore();
    });

    it('does NOT publish when disabled=true', () => {
      const { unmount } = renderTrackerHook({ disabled: true });
      act(() => triggerVisible(true));
      unmount();
      expect(publishMock).not.toHaveBeenCalled();
    });
  });
});
