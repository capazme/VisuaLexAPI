import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---- mocks (hoisted) ----
const useMerltFeaturesMock = vi.fn();
const useConsentMock = vi.fn();
const fetchProfile = vi.fn();
const getHealth = vi.fn();
const fetchHistoryMock = vi.fn();
const fetchPendingMock = vi.fn();
const fetchContribJobsMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

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
  getMerltHealth: (...a: unknown[]) => getHealth(...a),
  // NerOpsCard / OpsTrainingButton (opsVisible ops card) read via get/postMerlt.
  getMerlt: () => Promise.resolve({ total: 0, untrained: 0, by_type: {}, by_surface: {} }),
  postMerlt: () => Promise.resolve({ task_id: 't', status: 'queued' }),
}));
vi.mock('../../features/merlt/qa/qaApi', () => ({
  fetchHistory: (...a: unknown[]) => fetchHistoryMock(...a),
}));
vi.mock('../../features/merlt/validate/validateApi', () => ({
  fetchPendingQueue: (...a: unknown[]) => fetchPendingMock(...a),
}));
vi.mock('../../features/merlt/contrib/contribApi', () => ({
  fetchMyContribJobs: (...a: unknown[]) => fetchContribJobsMock(...a),
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
  qaAskable: true,
  canContribute: false,
  canValidate: false,
  graphReadable: true,
  opsVisible: false,
};

const baseConsent = {
  level: 'basic' as const,
  status: 'ready' as const,
  canTrack: true,
  error: null,
  consent: { level: 'basic', lastAuditAt: null },
  setConsent: vi.fn(),
  revokeConsent: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  useMerltFeaturesMock.mockReturnValue(baseFeatures);
  useConsentMock.mockReturnValue(baseConsent);
  fetchProfile.mockResolvedValue({
    userId: 'u1', authorityScore: 0.42, baselineQual: 'laurea', trackRecord: 0.5,
    performance: 0.6, totalContributions: 3, syncedAt: '2026-05-26T00:00:00.000Z',
  });
  getHealth.mockResolvedValue({ bff: 'ok', merlt: 'reachable', upstream: {} });
  fetchHistoryMock.mockResolvedValue([]);
  fetchPendingMock.mockResolvedValue({
    pending_entities: [], pending_relations: [], total_entities: 0, total_relations: 0, user_can_vote: 0,
  });
  fetchContribJobsMock.mockResolvedValue({ jobs: [] });
});

describe('MerltHubPage', () => {
  it('shows a "non disponibile" message when the feature is disabled', () => {
    useMerltFeaturesMock.mockReturnValue({ ...baseFeatures, merltEnabled: false });
    renderHub();
    expect(screen.getByText(/non è disponibile/i)).toBeInTheDocument();
  });

  it('renders the consent card with the current level and ladder', () => {
    renderHub();
    const card = screen.getByTestId('hub-card-consent');
    expect(card).toBeInTheDocument();
    expect(card).toHaveTextContent(/base/i);
    expect(screen.getByTestId('consent-ladder')).toBeInTheDocument();
    // ladder rungs
    expect(card).toHaveTextContent(/Leggi/);
    expect(card).toHaveTextContent(/Chiedi/);
    expect(card).toHaveTextContent(/Insegna/);
  });

  it('shows the graph card when the graph flag is enabled', () => {
    renderHub();
    expect(screen.getByTestId('hub-card-graph')).toBeInTheDocument();
    expect(screen.getByTestId('hub-card-graph').querySelector('a[href="/grafo"]')).not.toBeNull();
  });

  it('shows the graph card with consent none when the graph flag is on (reading is free)', () => {
    useMerltFeaturesMock.mockReturnValue({
      ...baseFeatures,
      consentLevel: 'none' as const,
      qaAskable: false,
      canTrack: false,
      graphEnabled: true,
    });
    useConsentMock.mockReturnValue({ ...baseConsent, level: 'none', consent: null });
    renderHub();
    expect(screen.getByTestId('hub-card-graph')).toBeInTheDocument();
  });

  it('hides the graph card when the graph flag is off', () => {
    useMerltFeaturesMock.mockReturnValue({ ...baseFeatures, graphEnabled: false, graphReadable: false });
    renderHub();
    expect(screen.queryByTestId('hub-card-graph')).not.toBeInTheDocument();
  });

  it('does not show the stale "(presto)" copy in the header', () => {
    renderHub();
    expect(screen.queryByText(/\(presto\)/)).not.toBeInTheDocument();
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

  it('gates the Q&A card at basic: shows an upsell when not askable, an action when askable', () => {
    // not askable
    useMerltFeaturesMock.mockReturnValue({ ...baseFeatures, qaAskable: false });
    const { rerender } = renderHub();
    const qaGated = screen.getByTestId('hub-card-qa');
    expect(qaGated).toHaveTextContent(/consenso base/i);

    // askable + no history → example prompt
    useMerltFeaturesMock.mockReturnValue({ ...baseFeatures, qaAskable: true });
    rerender(
      <MemoryRouter>
        <MerltHubPage />
      </MemoryRouter>,
    );
    return waitFor(() => {
      const qa = screen.getByTestId('hub-card-qa');
      expect(qa).toHaveTextContent(/Non hai ancora fatto domande/i);
    });
  });

  it('shows the last Q&A question with a confidence chip and a Riprendi action', async () => {
    fetchHistoryMock.mockResolvedValue([
      {
        trace_id: 't1', query: 'Cosa è il dolo?', synthesis: '…', mode: 'convergent',
        confidence: 0.8, experts_used: [], sources: [], created_at: null,
      },
    ]);
    renderHub();
    await waitFor(() => {
      const qa = screen.getByTestId('hub-card-qa');
      expect(qa).toHaveTextContent(/Cosa è il dolo\?/);
      expect(qa).toHaveTextContent(/80% affidabilità/);
      expect(qa).toHaveTextContent(/Riprendi/);
    });
  });

  it('gates the validation card without full consent and shows the live count with it', async () => {
    // gated
    renderHub();
    expect(screen.getByTestId('hub-card-validate')).toHaveTextContent(/consenso completo/i);

    // with canValidate + a non-empty queue
    useMerltFeaturesMock.mockReturnValue({ ...baseFeatures, canValidate: true });
    fetchPendingMock.mockResolvedValue({
      pending_entities: [{ id: 'e1' }, { id: 'e2' }],
      pending_relations: [{ id: 'r1' }],
      total_entities: 2, total_relations: 1, user_can_vote: 3,
    });
    renderHub();
    await waitFor(() => {
      const cards = screen.getAllByTestId('hub-card-validate');
      // the second render's card carries the count
      expect(cards.some((c) => /3/.test(c.textContent ?? '') && /proposte in attesa/i.test(c.textContent ?? ''))).toBe(true);
    });
  });

  it('shows a fail-soft pill when the validation count endpoint errors', async () => {
    useMerltFeaturesMock.mockReturnValue({ ...baseFeatures, canValidate: true });
    fetchPendingMock.mockRejectedValue(new Error('merlt_unavailable'));
    renderHub();
    await waitFor(() =>
      expect(screen.getByTestId('hub-card-validate')).toHaveTextContent(/non raggiungibile|non è stato possibile/i),
    );
  });

  it('gates the contrib card without full consent and shows last job status with it', async () => {
    renderHub();
    expect(screen.getByTestId('hub-card-contrib')).toHaveTextContent(/consenso completo/i);

    useMerltFeaturesMock.mockReturnValue({ ...baseFeatures, canContribute: true });
    fetchContribJobsMock.mockResolvedValue({
      jobs: [{
        id: 'j1', documentId: 7, status: 'completed', candidatesCreated: 4,
        errorMessage: null, createdAt: '2026-06-01', completedAt: '2026-06-01',
      }],
    });
    renderHub();
    await waitFor(() => {
      const cards = screen.getAllByTestId('hub-card-contrib');
      expect(cards.some((c) => /doc #7/.test(c.textContent ?? '') && /Completato/.test(c.textContent ?? ''))).toBe(true);
    });
  });

  it('loads and humanizes the authority profile (stars; raw number on hover only)', async () => {
    renderHub();
    await waitFor(() => {
      const card = screen.getByTestId('hub-card-profile');
      expect(card).toHaveTextContent(/Il peso del tuo voto/i);
      expect(card).toHaveTextContent('3'); // totalContributions
    });
    const card = screen.getByTestId('hub-card-profile');
    // The raw authority score is NOT a bare visible stat field; it lives on the
    // star row's hover title (design §3.3: humanized, number available on hover).
    expect(card).not.toHaveTextContent('0.42');
    expect(card.querySelector('[title="Authority 0.42"]')).not.toBeNull();
  });

  it('shows a degraded profile state when the profile fetch fails', async () => {
    fetchProfile.mockRejectedValue(new Error('merlt_unavailable'));
    renderHub();
    await waitFor(() =>
      expect(screen.getByTestId('hub-card-profile')).toHaveTextContent(/non disponibile|non disponibili/i),
    );
  });

  it('renders a "non raggiungibile" pill on the graph card when MERL-T is unreachable', async () => {
    getHealth.mockResolvedValue({ bff: 'ok', merlt: 'unreachable', error: 'down' });
    renderHub();
    await waitFor(() =>
      expect(screen.getByTestId('hub-card-graph')).toHaveTextContent(/non raggiungibile/i),
    );
  });

  it('exposes a revoke action on the consent card and calls revokeConsent on confirm', async () => {
    const revokeConsent = vi.fn().mockResolvedValue(undefined);
    useConsentMock.mockReturnValue({ ...baseConsent, revokeConsent });
    renderHub();
    // click "Revoca" in the consent card
    fireEvent.click(screen.getByRole('button', { name: /^Revoca$/ }));
    // confirm dialog appears with the danger confirm button
    const confirm = await screen.findByRole('button', { name: /Revoca consenso/i });
    fireEvent.click(confirm);
    await waitFor(() => expect(revokeConsent).toHaveBeenCalledTimes(1));
  });
});
