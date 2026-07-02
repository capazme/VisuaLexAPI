import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QaTurnModel } from '../types';

const features = vi.fn();
vi.mock('../../useMerltFeatures', () => ({
  useMerltFeatures: () => features(),
}));
// useQaThread is exercised in its own test; stub it so the page renders.
const thread = vi.fn();
vi.mock('../useQaThread', () => ({
  useQaThread: () => thread(),
}));
// ConsentDialog pulls in useConsent (throws outside a provider) — stub it to a
// visibility-reporting shim so the page can mount and the upsell can be probed.
vi.mock('../../consent/ConsentDialog', () => ({
  ConsentDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="consent-dialog" /> : null,
}));

import { QAPage } from '../QAPage';

function makeThread(overrides: Partial<ReturnType<typeof baseThread>> = {}) {
  return { ...baseThread(), ...overrides };
}

function baseThread() {
  return {
    turns: [] as QaTurnModel[],
    ask: vi.fn(),
    refine: vi.fn(),
    retry: vi.fn(),
    cancel: vi.fn(),
    rate: vi.fn(),
    rateSrc: vi.fn(),
    prefer: vi.fn(),
    detailed: vi.fn(),
    confirm: vi.fn(),
    clear: vi.fn(),
    loadHistoryTurn: vi.fn(),
  };
}

/** Default full-consent features; individual tests override the ladder flags. */
function fullFeatures(overrides: Record<string, unknown> = {}) {
  return {
    merltEnabled: true,
    qaAskable: true,
    canContribute: true,
    opsVisible: false,
    ...overrides,
  };
}

function renderPage(initialEntries: Parameters<typeof MemoryRouter>[0]['initialEntries'] = ['/merlt/qa']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QAPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  features.mockReset();
  thread.mockReset();
  thread.mockReturnValue(makeThread());
});

describe('QAPage gates (consent ladder D2)', () => {
  it('shows "non disponibile" when MERL-T is disabled', () => {
    features.mockReturnValue(fullFeatures({ merltEnabled: false }));
    renderPage();
    expect(screen.getByText(/non è disponibile/i)).toBeInTheDocument();
  });

  it('shows the basic-consent CTA when the user cannot even ask (qaAskable=false)', () => {
    features.mockReturnValue(fullFeatures({ qaAskable: false, canContribute: false }));
    renderPage();
    // Copy is split across a <strong>Base</strong> node — match on the stable prefix.
    expect(screen.getByText(/serve almeno il consenso/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /attiva il consenso/i })).toBeInTheDocument();
    // No composer while asking is not unlocked.
    expect(screen.queryByPlaceholderText(/Poni una domanda giuridica/i)).toBeNull();
  });

  it('renders the composer at basic consent (qaAskable, not canContribute)', () => {
    features.mockReturnValue(fullFeatures({ canContribute: false }));
    renderPage();
    expect(screen.getByPlaceholderText(/Poni una domanda giuridica/i)).toBeInTheDocument();
  });

  it('renders the composer with full consent', () => {
    features.mockReturnValue(fullFeatures());
    renderPage();
    expect(screen.getByPlaceholderText(/Poni una domanda giuridica/i)).toBeInTheDocument();
  });
});

describe('QAPage "Dev" toggle (opsVisible-gated)', () => {
  it('hides the Dev toggle for non-admin users', () => {
    features.mockReturnValue(fullFeatures({ opsVisible: false }));
    renderPage();
    expect(screen.queryByRole('button', { name: /dev/i })).toBeNull();
  });

  it('shows the Dev toggle when opsVisible', () => {
    features.mockReturnValue(fullFeatures({ opsVisible: true }));
    renderPage();
    expect(screen.getByRole('button', { name: /dev/i })).toBeInTheDocument();
  });
});

describe('QAPage error resilience (question preserved + Riprova)', () => {
  const errorTurn: QaTurnModel = {
    id: 'turn-err',
    question: 'art 1453?',
    state: { status: 'error', error: 'Il motore MERL-T non è al momento raggiungibile. Riprova più tardi.' },
    confirmed: {},
    request: { kind: 'ask', mode: 'convergent' },
  };

  it('keeps the failed question visible with an Italian error message', () => {
    features.mockReturnValue(fullFeatures());
    thread.mockReturnValue(makeThread({ turns: [errorTurn] }));
    renderPage();
    expect(screen.getByText('art 1453?')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/non è al momento raggiungibile/i);
  });

  it('"Riprova" re-submits the same turn', () => {
    features.mockReturnValue(fullFeatures());
    const retry = vi.fn();
    thread.mockReturnValue(makeThread({ turns: [errorTurn], retry }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /riprova/i }));
    expect(retry).toHaveBeenCalledWith('turn-err');
  });
});

describe('QAPage waiting UX (Annulla)', () => {
  const loadingTurn: QaTurnModel = {
    id: 'turn-load',
    question: 'art 1453?',
    state: { status: 'loading', startedAt: Date.now() },
    confirmed: {},
    request: { kind: 'ask', mode: 'convergent' },
  };

  it('shows an Annulla button while loading and wires it to cancel(turnId)', () => {
    features.mockReturnValue(fullFeatures());
    const cancel = vi.fn();
    thread.mockReturnValue(makeThread({ turns: [loadingTurn], cancel }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /annulla/i }));
    expect(cancel).toHaveBeenCalledWith('turn-load');
  });

  it('keeps the composer editable while a turn is loading', () => {
    features.mockReturnValue(fullFeatures());
    thread.mockReturnValue(makeThread({ turns: [loadingTurn] }));
    renderPage();
    const textarea = screen.getByPlaceholderText(/Poni una domanda giuridica/i);
    expect(textarea).not.toBeDisabled();
  });
});

describe('QAPage prefill contract (§3.5)', () => {
  it('prefills the composer from location.state.prefillQuery', () => {
    features.mockReturnValue(fullFeatures());
    renderPage([
      {
        pathname: '/merlt/qa',
        state: { prefillQuery: 'Spiegami l’art. 2043 c.c.', articleUrn: 'urn:x~art2043' },
      },
    ]);
    const textarea = screen.getByPlaceholderText(/Poni una domanda giuridica/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Spiegami l’art. 2043 c.c.');
  });

  it('does not prefill when there is no router state', () => {
    features.mockReturnValue(fullFeatures());
    renderPage();
    const textarea = screen.getByPlaceholderText(/Poni una domanda giuridica/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
  });
});
