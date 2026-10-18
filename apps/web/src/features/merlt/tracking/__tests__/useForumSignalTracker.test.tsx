import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useForumSignalTracker } from '../useForumSignalTracker';

const sendEventMock = vi.fn().mockResolvedValue({ received: 1, timestamp: 't' });
const hasConsentMock = vi.fn().mockReturnValue(true);

vi.mock('../../../../services/merltService', async () => ({
  sendForumSignalEvent: (...args: unknown[]) => sendEventMock(...args),
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

describe('useForumSignalTracker', () => {
  it.each([
    [MERLT_EVENT_TYPES.forumLike, 'like'],
    [MERLT_EVENT_TYPES.forumDownload, 'download'],
    [MERLT_EVENT_TYPES.forumSuggestionAccepted, 'suggestion_accepted'],
    [MERLT_EVENT_TYPES.forumSuggestionDeclined, 'suggestion_declined'],
  ])('forwards %s as action=%s', (eventType, action) => {
    const { unmount } = renderHook(() => useForumSignalTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: eventType,
        metadata: {
          shared_env_id: '00000000-0000-0000-0000-00000000face',
          original_author_id: '00000000-0000-0000-0000-00000000fade',
        },
      });
    });

    // Never the author, even when a publisher still puts one on the bus: a third party.
    expect(sendEventMock).toHaveBeenCalledWith({
      action,
      sharedEnvId: '00000000-0000-0000-0000-00000000face',
    });
    unmount();
  });

  it('drops a suggestion event that carries no shared_env_id (a suggestion id is never a substitute)', () => {
    const { unmount } = renderHook(() => useForumSignalTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.forumSuggestionAccepted,
        metadata: {
          suggestion_id: '00000000-0000-0000-0000-0000000000bb',
        },
      });
    });

    expect(sendEventMock).not.toHaveBeenCalled();
    unmount();
  });

  it('keys a suggestion event to the shared environment, not to the suggestion', () => {
    const { unmount } = renderHook(() => useForumSignalTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.forumSuggestionDeclined,
        metadata: {
          suggestion_id: '00000000-0000-0000-0000-0000000000bb',
          shared_env_id: '00000000-0000-0000-0000-0000000000ee',
        },
      });
    });

    expect(sendEventMock).toHaveBeenCalledWith({
      action: 'suggestion_declined',
      sharedEnvId: '00000000-0000-0000-0000-0000000000ee',
    });
    unmount();
  });

  it('ignores unrelated event types', () => {
    const { unmount } = renderHook(() => useForumSignalTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.articleViewed,
        article_urn: 'urn:test',
      });
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.bookmarkCreated,
        article_urn: 'urn:test',
      });
    });

    expect(sendEventMock).not.toHaveBeenCalled();
    unmount();
  });

  it('skips emit without consent', () => {
    hasConsentMock.mockReturnValue(false);
    const { unmount } = renderHook(() => useForumSignalTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.forumLike,
        metadata: { shared_env_id: '00000000-0000-0000-0000-00000000face' },
      });
    });

    expect(sendEventMock).not.toHaveBeenCalled();
    unmount();
  });

  it('skips emit when both shared_env_id and suggestion_id missing', () => {
    const { unmount } = renderHook(() => useForumSignalTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.forumLike,
        metadata: {},
      });
    });

    expect(sendEventMock).not.toHaveBeenCalled();
    unmount();
  });
});
