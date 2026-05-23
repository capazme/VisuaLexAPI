import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHighlightAnnotationTracker } from '../useHighlightAnnotationTracker';

// Module mocks
const sendEventMock = vi.fn().mockResolvedValue({ received: 1, timestamp: 't' });
const hasConsentMock = vi.fn().mockReturnValue(true);

vi.mock('../../../../services/merltService', () => ({
  sendHighlightAnnotationEvent: (...args: unknown[]) => sendEventMock(...args),
}));

vi.mock('../../merltConsent', () => ({
  hasMerltConsent: () => hasConsentMock(),
}));

// Import the bus *after* mocks so the real publish/subscribe wiring is used
import { publishMerltEvent, MERLT_EVENT_TYPES } from '../../merltEventBus';

// publishMerltEvent in the real module also calls trackMerltInteraction()
// which would 404 against a non-existent endpoint in tests. We don't care
// about that path here — vitest just catches the unhandled promise reject.
vi.mock('../../../../services/merltService', async () => {
  return {
    sendHighlightAnnotationEvent: (...args: unknown[]) => sendEventMock(...args),
    trackMerltInteraction: vi.fn().mockResolvedValue({}),
  };
});

beforeEach(() => {
  sendEventMock.mockClear();
  hasConsentMock.mockClear();
  hasConsentMock.mockReturnValue(true);
});

describe('useHighlightAnnotationTracker', () => {
  it('subscribes to the bus and forwards highlight events', () => {
    const { unmount } = renderHook(() => useHighlightAnnotationTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.highlightCreated,
        article_urn: 'urn:nir~art1175',
        metadata: {
          anchor_text: 'la buona fede',
          color: 'yellow',
          start_offset: 42,
          text_length: 13,
        },
      });
    });

    expect(sendEventMock).toHaveBeenCalledTimes(1);
    expect(sendEventMock).toHaveBeenCalledWith({
      kind: 'highlight',
      anchorText: 'la buona fede',
      startOffset: 42,
      articleUrn: 'urn:nir~art1175',
      color: 'yellow',
    });
    unmount();
  });

  it('forwards annotation events with note_text', () => {
    const { unmount } = renderHook(() => useHighlightAnnotationTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.annotationCreated,
        article_urn: 'urn:nir~art2043',
        metadata: {
          anchor_text: 'art. 2043',
          start_offset: 0,
          note_text: 'Responsabilità extracontrattuale',
          source: 'annotation',
          anchored: true,
        },
      });
    });

    expect(sendEventMock).toHaveBeenCalledWith({
      kind: 'annotation',
      anchorText: 'art. 2043',
      startOffset: 0,
      articleUrn: 'urn:nir~art2043',
      noteText: 'Responsabilità extracontrattuale',
    });
    unmount();
  });

  it('ignores unrelated event types (bookmark/textSelected/etc)', () => {
    const { unmount } = renderHook(() => useHighlightAnnotationTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.bookmarkCreated,
        article_urn: 'urn:test',
        metadata: { source: 'quick_norm' },
      });
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.textSelected,
        article_urn: 'urn:test',
        metadata: { text_length: 10 },
      });
    });

    expect(sendEventMock).not.toHaveBeenCalled();
    unmount();
  });

  it('skips emit when consent is missing', () => {
    hasConsentMock.mockReturnValue(false);
    const { unmount } = renderHook(() => useHighlightAnnotationTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.highlightCreated,
        article_urn: 'urn:test',
        metadata: { anchor_text: 'x', color: 'red', start_offset: 0 },
      });
    });

    expect(sendEventMock).not.toHaveBeenCalled();
    unmount();
  });

  it('skips emit when anchorText is empty', () => {
    const { unmount } = renderHook(() => useHighlightAnnotationTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.highlightCreated,
        article_urn: 'urn:test',
        metadata: { anchor_text: '', color: 'yellow', start_offset: 0 },
      });
    });

    expect(sendEventMock).not.toHaveBeenCalled();
    unmount();
  });

  it('skips emit when disabled=true', () => {
    const { unmount } = renderHook(() => useHighlightAnnotationTracker(true));

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.highlightCreated,
        article_urn: 'urn:test',
        metadata: { anchor_text: 'x', color: 'yellow', start_offset: 0 },
      });
    });

    expect(sendEventMock).not.toHaveBeenCalled();
    unmount();
  });

  it('unsubscribes on unmount (no leak)', () => {
    const { unmount } = renderHook(() => useHighlightAnnotationTracker());
    unmount();

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.highlightCreated,
        article_urn: 'urn:test',
        metadata: { anchor_text: 'x', color: 'yellow', start_offset: 0 },
      });
    });

    expect(sendEventMock).not.toHaveBeenCalled();
  });
});
