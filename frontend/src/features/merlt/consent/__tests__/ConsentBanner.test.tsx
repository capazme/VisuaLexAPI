import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { MerltInteractionEvent } from '../../../../services/merltService';

// ---- mocks (hoisted) ----
const useConsentMock = vi.fn();
const isMerltEnabledMock = vi.fn();
let busListener: ((e: MerltInteractionEvent) => void) | null = null;
const unsubscribe = vi.fn();

vi.mock('../useConsent', () => ({ useConsent: () => useConsentMock() }));
vi.mock('../../featureFlag', () => ({ isMerltEnabled: () => isMerltEnabledMock() }));
vi.mock('../../merltEventBus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../merltEventBus')>()),
  subscribeMerltEvents: (l: (e: MerltInteractionEvent) => void) => {
    busListener = l;
    return unsubscribe;
  },
}));
vi.mock('../ConsentDialog', () => ({
  ConsentDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="dialog-open" /> : null,
}));

import { ConsentBanner } from '../ConsentBanner';

function fireTrackable() {
  act(() => {
    busListener?.({ interaction_type: 'article_viewed' });
  });
}

beforeEach(() => {
  useConsentMock.mockReturnValue({ level: 'none', status: 'ready' });
  isMerltEnabledMock.mockReturnValue(true);
  busListener = null;
  unsubscribe.mockReset();
});

describe('ConsentBanner', () => {
  it('is hidden until a trackable action occurs', () => {
    render(<ConsentBanner />);
    expect(screen.queryByTestId('consent-banner')).not.toBeInTheDocument();
  });

  it('appears after the first trackable action when consent is none', () => {
    render(<ConsentBanner />);
    fireTrackable();
    expect(screen.getByTestId('consent-banner')).toBeInTheDocument();
  });

  it('ignores non-tracking bus events (e.g. scroll, text selection)', () => {
    render(<ConsentBanner />);
    act(() => {
      busListener?.({ interaction_type: 'scroll' });
      busListener?.({ interaction_type: 'text_selection' });
    });
    expect(screen.queryByTestId('consent-banner')).not.toBeInTheDocument();
  });

  it('"Non ora" dismisses it for the session', () => {
    render(<ConsentBanner />);
    fireTrackable();
    fireEvent.click(screen.getByRole('button', { name: /non ora/i }));
    expect(screen.queryByTestId('consent-banner')).not.toBeInTheDocument();
    // further events do not re-show it
    fireTrackable();
    expect(screen.queryByTestId('consent-banner')).not.toBeInTheDocument();
  });

  it('"Gestisci" opens the consent dialog', () => {
    render(<ConsentBanner />);
    fireTrackable();
    fireEvent.click(screen.getByRole('button', { name: /gestisci|scopri/i }));
    expect(screen.getByTestId('dialog-open')).toBeInTheDocument();
  });

  it('never appears when consent is already granted', () => {
    useConsentMock.mockReturnValue({ level: 'basic', status: 'ready' });
    render(<ConsentBanner />);
    fireTrackable();
    expect(screen.queryByTestId('consent-banner')).not.toBeInTheDocument();
  });

  it('never appears when the feature is disabled', () => {
    isMerltEnabledMock.mockReturnValue(false);
    render(<ConsentBanner />);
    fireTrackable();
    expect(screen.queryByTestId('consent-banner')).not.toBeInTheDocument();
  });
});
