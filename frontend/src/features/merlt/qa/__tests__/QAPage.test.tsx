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
    rate: vi.fn(),
    rateSrc: vi.fn(),
    prefer: vi.fn(),
    detailed: vi.fn(),
    confirm: vi.fn(),
    clear: vi.fn(),
    loadHistoryTurn: vi.fn(),
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <QAPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  features.mockReset();
  thread.mockReset();
  thread.mockReturnValue(makeThread());
});

describe('QAPage gates', () => {
  it('shows "non disponibile" when MERL-T is disabled', () => {
    features.mockReturnValue({ merltEnabled: false, canContribute: false, opsVisible: false });
    renderPage();
    expect(screen.getByText(/non è disponibile/i)).toBeInTheDocument();
  });

  it('shows the consent CTA when consent is not full', () => {
    features.mockReturnValue({ merltEnabled: true, canContribute: false, opsVisible: false });
    renderPage();
    expect(screen.getByText(/consenso/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /impostazioni MERL-T/i })).toBeInTheDocument();
  });

  it('renders the composer with full consent', () => {
    features.mockReturnValue({ merltEnabled: true, canContribute: true, opsVisible: false });
    renderPage();
    expect(screen.getByPlaceholderText(/Poni una domanda giuridica/i)).toBeInTheDocument();
  });
});

describe('QAPage "Dev" toggle (opsVisible-gated)', () => {
  it('hides the Dev toggle for non-admin users', () => {
    features.mockReturnValue({ merltEnabled: true, canContribute: true, opsVisible: false });
    renderPage();
    expect(screen.queryByRole('button', { name: /dev/i })).toBeNull();
  });

  it('shows the Dev toggle when opsVisible', () => {
    features.mockReturnValue({ merltEnabled: true, canContribute: true, opsVisible: true });
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
    features.mockReturnValue({ merltEnabled: true, canContribute: true, opsVisible: false });
    thread.mockReturnValue(makeThread({ turns: [errorTurn] }));
    renderPage();
    expect(screen.getByText('art 1453?')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/non è al momento raggiungibile/i);
  });

  it('"Riprova" re-submits the same turn', () => {
    features.mockReturnValue({ merltEnabled: true, canContribute: true, opsVisible: false });
    const retry = vi.fn();
    thread.mockReturnValue(makeThread({ turns: [errorTurn], retry }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /riprova/i }));
    expect(retry).toHaveBeenCalledWith('turn-err');
  });
});
