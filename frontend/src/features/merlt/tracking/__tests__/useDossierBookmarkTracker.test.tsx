import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDossierBookmarkTracker } from '../useDossierBookmarkTracker';

const sendEventMock = vi.fn().mockResolvedValue({ received: 1, timestamp: 't' });
const hasConsentMock = vi.fn().mockReturnValue(true);

vi.mock('../../../../services/merltService', async () => ({
  sendDossierBookmarkEvent: (...args: unknown[]) => sendEventMock(...args),
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

describe('useDossierBookmarkTracker', () => {
  it('forwards bookmark_add → kind=bookmark', () => {
    const { unmount } = renderHook(() => useDossierBookmarkTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.bookmarkCreated,
        article_urn: 'urn:nir~art2043',
        metadata: { source: 'bookmark', tags: ['responsabilità'] },
      });
    });

    expect(sendEventMock).toHaveBeenCalledWith({
      kind: 'bookmark',
      articleUrn: 'urn:nir~art2043',
      tags: ['responsabilità'],
    });
    unmount();
  });

  it('forwards dossier_item_add → kind=dossier with dossierId', () => {
    const { unmount } = renderHook(() => useDossierBookmarkTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.dossierItemAdded,
        article_urn: 'urn:nir~art1218',
        metadata: { dossier_id: '00000000-0000-0000-0000-000000000aaa' },
      });
    });

    expect(sendEventMock).toHaveBeenCalledWith({
      kind: 'dossier',
      articleUrn: 'urn:nir~art1218',
      dossierId: '00000000-0000-0000-0000-000000000aaa',
      tags: undefined,
    });
    unmount();
  });

  it('ignores unrelated event types', () => {
    const { unmount } = renderHook(() => useDossierBookmarkTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.highlightCreated,
        article_urn: 'urn:test',
        metadata: { anchor_text: 'x' },
      });
    });

    expect(sendEventMock).not.toHaveBeenCalled();
    unmount();
  });

  it('skips emit without consent', () => {
    hasConsentMock.mockReturnValue(false);
    const { unmount } = renderHook(() => useDossierBookmarkTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.bookmarkCreated,
        article_urn: 'urn:test',
      });
    });

    expect(sendEventMock).not.toHaveBeenCalled();
    unmount();
  });

  it('skips emit when article_urn missing', () => {
    const { unmount } = renderHook(() => useDossierBookmarkTracker());

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.bookmarkCreated,
        // intentionally omitting article_urn
      });
    });

    expect(sendEventMock).not.toHaveBeenCalled();
    unmount();
  });
});
