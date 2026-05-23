import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useForumSignalTracker } from '../useForumSignalTracker';

const sendEventMock = vi.fn().mockResolvedValue({ received: 1, timestamp: 't' });
const hasConsentMock = vi.fn().mockReturnValue(true);

vi.mock('../../../../services/merltService', async () => ({
  sendForumSignalEvent: (...args: unknown[]) => sendEventMock(...args),
  trackMerltInteraction: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../merltConsent', () => ({
  hasMerltConsent: () => hasConsentMock(),
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

    expect(sendEventMock).toHaveBeenCalledWith({
      action,
      sharedEnvId: '00000000-0000-0000-0000-00000000face',
      originalAuthorId: '00000000-0000-0000-0000-00000000fade',
    });
    unmount();
  });

  it('forwards null originalAuthorId when author is deleted', () => {
    const { unmount } = renderHook(() => useForumSignalTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.forumLike,
        metadata: {
          shared_env_id: '00000000-0000-0000-0000-00000000face',
          original_author_id: null,
        },
      });
    });

    expect(sendEventMock).toHaveBeenCalledWith({
      action: 'like',
      sharedEnvId: '00000000-0000-0000-0000-00000000face',
      originalAuthorId: null,
    });
    unmount();
  });

  it('falls back to suggestion_id when shared_env_id missing', () => {
    const { unmount } = renderHook(() => useForumSignalTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.forumSuggestionAccepted,
        metadata: {
          suggestion_id: '00000000-0000-0000-0000-0000000000bb',
          original_author_id: null,
        },
      });
    });

    expect(sendEventMock).toHaveBeenCalledWith({
      action: 'suggestion_accepted',
      sharedEnvId: '00000000-0000-0000-0000-0000000000bb',
      originalAuthorId: null,
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
