import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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

/** The consent and the profile open from the row at the page's foot (S7b). */
function openFoot(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
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

const NOTICE = { id: 'n1', versione: 1, titolo: 'Informativa MERL-T', corpo: 'Il testo.', conferma: 'Ho letto', azione: 'Leggi' };

const baseConsent = {
  level: 'basic' as const,
  status: 'ready' as const,
  notice: NOTICE,
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
    openFoot(/Consenso e privacy/);
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

  it('says Academia\'s line over its name (L-37)', () => {
    renderHub();
    expect(screen.getByRole('heading', { level: 1, name: 'Assistente' })).toHaveAccessibleDescription('Academia · il laboratorio del diritto');
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

  it('says a validation count it cannot read in the card\'s text', async () => {
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
    openFoot(/Il tuo profilo/);
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
    openFoot(/Il tuo profilo/);
    await waitFor(() =>
      expect(screen.getByTestId('hub-card-profile')).toHaveTextContent(/non disponibile|non disponibili/i),
    );
  });

  it('says on the graph card that MERL-T is unreachable, in its text', async () => {
    getHealth.mockResolvedValue({ bff: 'ok', merlt: 'unreachable', error: 'down' });
    renderHub();
    await waitFor(() =>
      expect(screen.getByTestId('hub-card-graph')).toHaveTextContent(/non raggiungibile/i),
    );
  });

  it('exposes a revoke action on the consent card: revoke only, or revoke and erase', async () => {
    const revokeConsent = vi.fn().mockResolvedValue({ erasureCompleted: false });
    useConsentMock.mockReturnValue({ ...baseConsent, revokeConsent });
    renderHub();
    openFoot(/Consenso e privacy/);
    // click "Revoca" in the consent card
    fireEvent.click(screen.getByRole('button', { name: /^Revoca$/ }));
    // the dialog names both ways out
    expect(await screen.findByRole('button', { name: /Revoca ed elimina i dati raccolti/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Revoca soltanto/i }));
    await waitFor(() => expect(revokeConsent).toHaveBeenCalledWith({ reason: expect.any(String), deleteData: false }));
  });
});

// Consent first (S7b): with no consent the page opens on what MERL-T does and collects, four cards follow with one
// action each, and the consent and the profile go down to a row of links.
describe('MerltHubPage — consent first (S7b)', () => {
  const none = () => {
    useMerltFeaturesMock.mockReturnValue({ ...baseFeatures, consentLevel: 'none' as const, qaAskable: false, canTrack: false });
    useConsentMock.mockReturnValue({ ...baseConsent, level: 'none', consent: null });
  };

  it('opens on «Attiva MERL-T» with no consent, whose button opens the consent dialog', () => {
    none();
    renderHub();
    const block = screen.getByTestId('hub-consent-first');
    expect(block).toHaveTextContent('Attiva MERL-T');
    // What it collects, in the levels' words: never the notes' text.
    // What it collects, said as such, in the levels' words.
    expect(block).toHaveTextContent('Che cosa raccoglie. Con il consenso base: le tue letture');
    expect(block).toHaveTextContent('note (mai il loro testo)');
    expect(block).toHaveTextContent('le citazioni con il testo intorno');
    expect(screen.queryByTestId('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Scegli il consenso' }));
    expect(screen.getByTestId('dialog')).toBeInTheDocument();
  });

  it('leaves the block out once a consent is given, and while the consent is being read', () => {
    renderHub();
    expect(screen.queryByTestId('hub-consent-first')).toBeNull();
    none();
    useConsentMock.mockReturnValue({ ...baseConsent, level: 'none', consent: null, status: 'loading' });
    renderHub();
    expect(screen.queryByTestId('hub-consent-first')).toBeNull();
  });

  it('shows four cards, the actions that need more consent saying so and disabled, no badge', () => {
    none();
    renderHub();
    const cards = ['hub-card-qa', 'hub-card-validate', 'hub-card-graph', 'hub-card-contrib'].map((id) => screen.getByTestId(id));
    expect(screen.queryByTestId('hub-card-consent')).toBeNull();
    expect(screen.queryByTestId('hub-card-profile')).toBeNull();
    // Said, and reachable: `aria-disabled`, in the Tab order.
    for (const [card, name] of [[cards[0], 'Serve il consenso base'], [cards[1], 'Serve il consenso completo'], [cards[3], 'Serve il consenso completo']] as const) {
      const action = within(card).getByRole('button', { name });
      expect(action).toHaveAttribute('aria-disabled', 'true');
      expect(action).not.toBeDisabled();
    }
    // Reading the graph is free: its action is a link, and no card nests a button in a link.
    expect(within(cards[2]).getByRole('link', { name: 'Esplora il grafo' })).toHaveAttribute('href', '/grafo');
    for (const card of cards) expect(card.querySelector('a button, button a')).toBeNull();
  });

  it('says MERL-T is not active on a server without it (no notice), with no button that does nothing', () => {
    none();
    useConsentMock.mockReturnValue({ ...baseConsent, level: 'none', consent: null, notice: null });
    renderHub();
    expect(screen.queryByTestId('hub-consent-first')).toBeNull();
    expect(screen.getByTestId('hub-consent-unavailable')).toHaveTextContent('MERL-T non è attivo su questo server');
    expect(screen.queryByRole('button', { name: 'Scegli il consenso' })).toBeNull();
    expect(within(screen.getByTestId('hub-card-qa')).getByRole('button', { name: 'Non attivo su questo server' })).toHaveAttribute('aria-disabled', 'true');
    // Nor a «Gestisci» in the consent's panel.
    fireEvent.click(screen.getByRole('button', { name: /Consenso e privacy/ }));
    expect(within(screen.getByTestId('hub-card-consent')).queryByRole('button', { name: 'Gestisci' })).toBeNull();
  });

  it('says the consent could not be read when the read fails, and reads it again on «Riprova»', () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    none();
    useConsentMock.mockReturnValue({ ...baseConsent, level: 'none', consent: null, notice: null, status: 'error', error: 'boom', refresh });
    renderHub();
    expect(screen.getByTestId('hub-consent-unavailable')).toHaveTextContent('Non è stato possibile leggere il tuo consenso a MERL-T.');
    expect(within(screen.getByTestId('hub-card-validate')).getByRole('button', { name: 'Consenso non letto' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Serve il consenso/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('offers no action that needs consent while the consent is being read', () => {
    none();
    useConsentMock.mockReturnValue({ ...baseConsent, level: 'none', consent: null, status: 'loading' });
    renderHub();
    expect(screen.queryByRole('button', { name: /Serve il consenso/ })).toBeNull();
  });

  it('opens the consent and the profile from the row at the foot, one at a time', () => {
    renderHub();
    const consent = screen.getByRole('button', { name: /Consenso e privacy/ });
    const profile = screen.getByRole('button', { name: /Il tuo profilo/ });
    // The level as the consent screen names it (`levels.ts`).
    expect(consent).toHaveTextContent('· Base');
    expect(consent).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(consent);
    expect(consent).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('hub-card-consent')).toBeInTheDocument();
    fireEvent.click(profile);
    expect(screen.queryByTestId('hub-card-consent')).toBeNull();
    expect(screen.getByTestId('hub-card-profile')).toBeInTheDocument();
    for (const button of [consent, profile]) expect(button).toHaveClass('min-h-[44px]');
  });
});
