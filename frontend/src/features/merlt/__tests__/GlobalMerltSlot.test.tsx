import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { createRef } from 'react';
import { GlobalMerltSlot } from '../GlobalMerltSlot';
import { ArticleMerltSlot } from '../ArticleMerltSlot';

// Slice 3 §3.9 regression guard: the bus-subscriber trackers (highlight,
// dossier/bookmark, citation) are mounted ONCE in GlobalMerltSlot. Mounting
// them per article card (the old ArticleMerltSlot wiring) duplicated every
// BFF POST ×N open cards and dropped events emitted outside any article view.

const sendHighlightMock = vi.fn().mockResolvedValue({ received: 1, timestamp: 't' });
const sendDossierMock = vi.fn().mockResolvedValue({ received: 1, timestamp: 't' });
const sendCitationMock = vi.fn().mockResolvedValue({ received: 1, timestamp: 't' });

vi.mock('../../../services/merltService', async () => ({
  sendHighlightAnnotationEvent: (...args: unknown[]) => sendHighlightMock(...args),
  sendDossierBookmarkEvent: (...args: unknown[]) => sendDossierMock(...args),
  sendCitationClickedEvent: (...args: unknown[]) => sendCitationMock(...args),
  sendForumSignalEvent: vi.fn().mockResolvedValue({ received: 1, timestamp: 't' }),
  trackMerltInteraction: vi.fn().mockResolvedValue({}),
}));

vi.mock('../consent/useConsent', () => ({
  useConsent: () => ({ canTrack: true, level: 'full', status: 'ready' }),
}));

// The banner pulls in dialog/flag machinery irrelevant to tracker wiring.
vi.mock('../consent/ConsentBanner', () => ({
  ConsentBanner: () => null,
}));

// jsdom has no IntersectionObserver; the dwell tracker is out of scope here.
vi.mock('../tracking/useArticleViewedTracker', () => ({
  useArticleViewedTracker: vi.fn(),
}));

import { publishMerltEvent, MERLT_EVENT_TYPES } from '../merltEventBus';
import { useArticleViewedTracker } from '../tracking/useArticleViewedTracker';

function ArticleSlot({ urn }: { urn: string }) {
  return (
    <ArticleMerltSlot
      articleUrn={urn}
      containerRef={createRef<HTMLElement | null>()}
    />
  );
}

beforeEach(() => {
  sendHighlightMock.mockClear();
  sendDossierMock.mockClear();
  sendCitationMock.mockClear();
  vi.mocked(useArticleViewedTracker).mockClear();
});

describe('GlobalMerltSlot tracker wiring (single subscription)', () => {
  it('emits exactly 1 highlight POST with 2 article slots mounted', () => {
    const { unmount } = render(
      <>
        <GlobalMerltSlot />
        <ArticleSlot urn="urn:nir~art1175" />
        <ArticleSlot urn="urn:nir~art2043" />
      </>
    );

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.highlightCreated,
        article_urn: 'urn:nir~art1175',
        metadata: { anchor_text: 'la buona fede', color: 'yellow', start_offset: 42 },
      });
    });

    expect(sendHighlightMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('captures a dossier-add emitted outside any article view', () => {
    const { unmount } = render(<GlobalMerltSlot />);

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.dossierItemAdded,
        article_urn: 'urn:nir~art1218',
        metadata: { dossier_id: '00000000-0000-0000-0000-000000000aaa' },
      });
    });

    expect(sendDossierMock).toHaveBeenCalledTimes(1);
    expect(sendDossierMock).toHaveBeenCalledWith({
      kind: 'dossier',
      articleUrn: 'urn:nir~art1218',
      dossierId: '00000000-0000-0000-0000-000000000aaa',
      tags: undefined,
    });
    unmount();
  });

  it('forwards citation clicks exactly once per event', () => {
    const { unmount } = render(
      <>
        <GlobalMerltSlot />
        <ArticleSlot urn="urn:nir~art2043" />
      </>
    );

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.citationClicked,
        article_urn: 'urn:nir~art2043',
        metadata: {
          source_urn: 'urn:nir~art2043',
          target_urn: 'urn:nir~art1223',
          citation_text: 'art. 1223 c.c.',
        },
      });
    });

    expect(sendCitationMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('ArticleMerltSlot hosts only the article-viewed tracker (no bus subscribers)', () => {
    const { unmount } = render(<ArticleSlot urn="urn:nir~art1175" />);

    expect(useArticleViewedTracker).toHaveBeenCalledTimes(1);

    act(() => {
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.highlightCreated,
        article_urn: 'urn:nir~art1175',
        metadata: { anchor_text: 'x', color: 'yellow', start_offset: 0 },
      });
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.dossierItemAdded,
        article_urn: 'urn:nir~art1175',
        metadata: { dossier_id: 'd1' },
      });
      publishMerltEvent({
        interaction_type: MERLT_EVENT_TYPES.citationClicked,
        article_urn: 'urn:nir~art1175',
        metadata: { source_urn: 'urn:nir~art1175', citation_text: 'art. 1 c.c.' },
      });
    });

    // Without GlobalMerltSlot mounted, no bus subscriber exists.
    expect(sendHighlightMock).not.toHaveBeenCalled();
    expect(sendDossierMock).not.toHaveBeenCalled();
    expect(sendCitationMock).not.toHaveBeenCalled();
    unmount();
  });
});
