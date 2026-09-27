import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCitationTracker } from '../useCitationTracker';

const sendEventMock = vi.fn().mockResolvedValue({ received: 1, timestamp: 't' });
const hasConsentMock = vi.fn().mockReturnValue(true);

vi.mock('../../../../services/merltService', async () => ({
  sendCitationClickedEvent: (...args: unknown[]) => sendEventMock(...args),
  trackMerltInteraction: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../consent/useConsent', () => ({
  useConsent: () => ({ canTrack: hasConsentMock() }),
}));

import { publishMerltEvent, MERLT_EVENT_TYPES } from '../../merltEventBus';

beforeEach(() => {
  sendEventMock.mockClear();
  hasConsentMock.mockClear();
  hasConsentMock.mockReturnValue(true);
});

describe('useCitationTracker', () => {
  it('forwards citation_click with source + target + text', () => {
    const { unmount } = renderHook(() => useCitationTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.citationClicked,
        article_urn: 'urn:nir~art1175',
        metadata: {
          source_urn: 'urn:nir~art1175',
          target_urn: 'urn:nir~art1218',
          citation_text: 'art. 1218 c.c.',
        },
      });
    });

    expect(sendEventMock).toHaveBeenCalledWith({
      sourceArticleUrn: 'urn:nir~art1175',
      targetArticleUrn: 'urn:nir~art1218',
      citationText: 'art. 1218 c.c.',
    });
    unmount();
  });

  it('forwards null target (unresolved citation)', () => {
    const { unmount } = renderHook(() => useCitationTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.citationClicked,
        article_urn: 'urn:nir~art1',
        metadata: {
          source_urn: 'urn:nir~art1',
          target_urn: null,
          citation_text: 'vedi precedente',
        },
      });
    });

    expect(sendEventMock).toHaveBeenCalledWith({
      sourceArticleUrn: 'urn:nir~art1',
      targetArticleUrn: null,
      citationText: 'vedi precedente',
    });
    unmount();
  });

  it('falls back to article_urn when source_urn missing', () => {
    const { unmount } = renderHook(() => useCitationTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.citationClicked,
        article_urn: 'urn:nir~art1',
        metadata: {
          citation_text: 'art. X',
        },
      });
    });

    expect(sendEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceArticleUrn: 'urn:nir~art1', targetArticleUrn: null })
    );
    unmount();
  });

  it('ignores unrelated event types', () => {
    const { unmount } = renderHook(() => useCitationTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.bookmarkCreated,
        article_urn: 'urn:test',
      });
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.citationDetected, // detection, not click
        article_urn: 'urn:test',
        metadata: { citation_text: 'x' },
      });
    });

    expect(sendEventMock).not.toHaveBeenCalled();
    unmount();
  });

  it('skips emit without citation_text', () => {
    const { unmount } = renderHook(() => useCitationTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.citationClicked,
        article_urn: 'urn:nir~art1',
        metadata: { source_urn: 'urn:nir~art1', target_urn: null },
      });
    });

    expect(sendEventMock).not.toHaveBeenCalled();
    unmount();
  });

  it('skips emit without consent', () => {
    hasConsentMock.mockReturnValue(false);
    const { unmount } = renderHook(() => useCitationTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.citationClicked,
        article_urn: 'urn:test',
        metadata: { source_urn: 'urn:test', citation_text: 'x' },
      });
    });

    expect(sendEventMock).not.toHaveBeenCalled();
    unmount();
  });
});
