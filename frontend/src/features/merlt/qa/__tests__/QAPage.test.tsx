import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const features = vi.fn();
vi.mock('../../useMerltFeatures', () => ({
  useMerltFeatures: () => features(),
}));
// useQaThread is exercised in its own test; stub it so the page renders.
vi.mock('../useQaThread', () => ({
  useQaThread: () => ({
    turns: [],
    ask: vi.fn(),
    refine: vi.fn(),
    rate: vi.fn(),
    rateSrc: vi.fn(),
    prefer: vi.fn(),
    detailed: vi.fn(),
    confirm: vi.fn(),
    clear: vi.fn(),
    loadHistoryTurn: vi.fn(),
  }),
}));

import { QAPage } from '../QAPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <QAPage />
    </MemoryRouter>,
  );
}

beforeEach(() => features.mockReset());

describe('QAPage gates', () => {
  it('shows "non disponibile" when MERL-T is disabled', () => {
    features.mockReturnValue({ merltEnabled: false, canContribute: false });
    renderPage();
    expect(screen.getByText(/non è disponibile/i)).toBeInTheDocument();
  });

  it('shows the consent CTA when consent is not full', () => {
    features.mockReturnValue({ merltEnabled: true, canContribute: false });
    renderPage();
    expect(screen.getByText(/consenso/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /impostazioni MERL-T/i })).toBeInTheDocument();
  });

  it('renders the composer with full consent', () => {
    features.mockReturnValue({ merltEnabled: true, canContribute: true });
    renderPage();
    expect(screen.getByPlaceholderText(/Poni una domanda giuridica/i)).toBeInTheDocument();
  });
});
