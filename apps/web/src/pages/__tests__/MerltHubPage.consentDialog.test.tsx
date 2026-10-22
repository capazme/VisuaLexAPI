import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// «Attiva MERL-T» against the real consent dialog (S7b): the block shows only where the dialog has a notice to show,
// so «Scegli il consenso» never opens nothing — a server without MERL-T answers 404 `merlt_disabled`, read as a
// consent with no notice (`consentRead.ts`).
const useConsentMock = vi.fn();
vi.mock('../../features/merlt/consent/useConsent', () => ({ useConsent: () => useConsentMock() }));
vi.mock('../../features/merlt/useMerltFeatures', () => ({
  useMerltFeatures: () => ({
    merltEnabled: true, graphEnabled: true, consentLevel: 'none', status: 'ready', canTrack: false,
    qaAskable: false, canContribute: false, canValidate: false, graphReadable: true, opsVisible: false,
  }),
}));
vi.mock('../../services/merltService', () => ({
  fetchMerltProfile: () => new Promise(() => {}),
  getMerltHealth: () => new Promise(() => {}),
}));
vi.mock('../../features/merlt/qa/qaApi', () => ({ fetchHistory: () => new Promise(() => {}) }));
vi.mock('../../features/merlt/validate/validateApi', () => ({ fetchPendingQueue: () => new Promise(() => {}) }));
vi.mock('../../features/merlt/contrib/contribApi', () => ({ fetchMyContribJobs: () => new Promise(() => {}) }));

import { MerltHubPage } from '../MerltHubPage';

const NOTICE = { id: 'n1', versione: 1, titolo: 'Informativa MERL-T', corpo: 'Che cosa raccoglie MERL-T.', conferma: 'Ho letto l’informativa', azione: 'Leggi' };
const consent = (notice: typeof NOTICE | null) => ({
  status: 'ready', level: 'none', canTrack: false, needsAnswer: false, notice, error: null,
  consent: { level: 'none', storedLevel: 'none', noticeAnswered: true, notice, updatedAt: '2026-10-01T00:00:00.000Z', lastAuditAt: null },
  setConsent: vi.fn(), revokeConsent: vi.fn(), refresh: vi.fn(),
});

const renderHub = () => render(<MemoryRouter><MerltHubPage /></MemoryRouter>);

beforeEach(() => vi.clearAllMocks());

describe('MerltHubPage with the real consent dialog', () => {
  it('opens the notice from «Scegli il consenso»', () => {
    useConsentMock.mockReturnValue(consent(NOTICE));
    renderHub();
    fireEvent.click(screen.getByRole('button', { name: 'Scegli il consenso' }));
    expect(screen.getByRole('dialog', { name: 'Informativa MERL-T' })).toBeInTheDocument();
  });

  it('offers no «Scegli il consenso» where the dialog would have nothing to show', () => {
    useConsentMock.mockReturnValue(consent(null));
    renderHub();
    expect(screen.queryByRole('button', { name: 'Scegli il consenso' })).toBeNull();
    expect(screen.getByText(/MERL-T non è attivo su questo server/)).toBeInTheDocument();
  });
});
