import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---- mocks (hoisted) ----
const useMerltFeaturesMock = vi.fn();
const useConsentMock = vi.fn();
const fetchProfile = vi.fn();

vi.mock('../../features/merlt/useMerltFeatures', () => ({
  useMerltFeatures: () => useMerltFeaturesMock(),
}));
vi.mock('../../features/merlt/consent/useConsent', () => ({
  useConsent: () => useConsentMock(),
}));
vi.mock('../../features/merlt/consent/ConsentDialog', () => ({
  ConsentDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="dialog" /> : null),
}));
vi.mock('../../services/merltService', () => ({
  fetchMerltProfile: (...a: unknown[]) => fetchProfile(...a),
  // NerOpsCard (mounted in the opsVisible ops card) reads stats via getMerlt.
  getMerlt: () => Promise.resolve({ total: 0, untrained: 0, by_type: {}, by_surface: {} }),
  postMerlt: () => Promise.resolve({ task_id: 't', status: 'queued' }),
}));

import { MerltHubPage } from '../MerltHubPage';

function renderHub() {
  return render(
    <MemoryRouter>
      <MerltHubPage />
    </MemoryRouter>,
  );
}

const baseFeatures = {
  merltEnabled: true,
  graphEnabled: true,
  consentLevel: 'basic' as const,
  status: 'ready' as const,
  canTrack: true,
  canContribute: false,
  canValidate: false,
  graphReadable: true,
  opsVisible: false,
};

beforeEach(() => {
  useMerltFeaturesMock.mockReturnValue(baseFeatures);
  useConsentMock.mockReturnValue({ level: 'basic', status: 'ready', consent: { level: 'basic', lastAuditAt: null } });
  fetchProfile.mockResolvedValue({
    userId: 'u1', authorityScore: 0.42, baselineQual: 'laurea', trackRecord: 0.5,
    performance: 0.6, totalContributions: 3, syncedAt: '2026-05-26T00:00:00.000Z',
  });
});

describe('MerltHubPage', () => {
  it('shows a "non disponibile" message when the feature is disabled', () => {
    useMerltFeaturesMock.mockReturnValue({ ...baseFeatures, merltEnabled: false });
    renderHub();
    expect(screen.getByText(/non è disponibile/i)).toBeInTheDocument();
  });

  it('renders the consent card with the current level', () => {
    renderHub();
    expect(screen.getByTestId('hub-card-consent')).toBeInTheDocument();
    expect(screen.getByTestId('hub-card-consent')).toHaveTextContent(/base/i);
  });

  it('shows the graph card when graph is readable', () => {
    renderHub();
    expect(screen.getByTestId('hub-card-graph')).toBeInTheDocument();
  });

  it('hides the ops card for non-admins and shows it for admins', () => {
    const { rerender } = renderHub();
    expect(screen.queryByTestId('hub-card-ops')).not.toBeInTheDocument();
    useMerltFeaturesMock.mockReturnValue({ ...baseFeatures, opsVisible: true });
    rerender(
      <MemoryRouter>
        <MerltHubPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('hub-card-ops')).toBeInTheDocument();
  });

  it('loads and renders the authority profile', async () => {
    renderHub();
    await waitFor(() => expect(screen.getByTestId('hub-card-profile')).toHaveTextContent('3'));
  });

  it('shows a degraded profile state when the profile fetch fails', async () => {
    fetchProfile.mockRejectedValue(new Error('merlt_unavailable'));
    renderHub();
    await waitFor(() =>
      expect(screen.getByTestId('hub-card-profile')).toHaveTextContent(/non disponibile|non disponibili/i),
    );
  });
});
