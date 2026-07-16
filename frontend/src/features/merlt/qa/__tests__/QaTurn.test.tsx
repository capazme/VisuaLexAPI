import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { QaTurn, type QaTurnProps } from '../QaTurn';
import type { QaTurnModel, QaAnswer } from '../types';

function makeAnswer(overrides: Partial<QaAnswer> = {}): QaAnswer {
  return {
    trace_id: 't1',
    synthesis: 'La risoluzione richiede un inadempimento di non scarsa importanza.',
    mode: 'convergent',
    alternatives: null,
    sources: [],
    retrieved_sources: [
      { urn: 'urn:nir:art1453', provenance: 'seed', trust: 0.9, node_id: 'n1' },
    ],
    experts_used: ['literal'],
    confidence: 0.8,
    execution_time_ms: 10,
    ...overrides,
  };
}

function successTurn(overrides: Partial<QaAnswer> = {}): QaTurnModel {
  return {
    id: 'turn-1',
    question: 'art 1453?',
    state: { status: 'success', answer: makeAnswer(overrides) },
    confirmed: {},
    request: { kind: 'ask', mode: 'convergent' },
  };
}

function renderTurn({ turn, ...overrides }: Partial<QaTurnProps> & { turn: QaTurnModel }) {
  const base: QaTurnProps = {
    turn,
    onRate: vi.fn(),
    onRefine: vi.fn(),
    onConfirm: vi.fn(),
    onRateSource: vi.fn(),
    onPrefer: vi.fn(),
    onDetailed: vi.fn(),
    onRetry: vi.fn(),
    onCancel: vi.fn(),
    canContribute: true,
    onOpenConsent: vi.fn(),
    ...overrides,
  };
  return render(
    <MemoryRouter>
      <QaTurn {...base} />
    </MemoryRouter>,
  );
}

describe('QaTurn — sources always visible (§3.5)', () => {
  it('renders the source chips directly under the answer, not only in the deliberation panel', () => {
    renderTurn({ turn: successTurn() });
    // "Fonti consultate (N)" heading is present at the turn level.
    expect(screen.getByText(/Fonti consultate \(1\)/i)).toBeInTheDocument();
    // The details panel ("Come ci sono arrivato") no longer owns the sources.
    const details = screen.getByText(/Come ci sono arrivato/i).closest('details');
    expect(details).not.toBeNull();
    expect(within(details as HTMLElement).queryByText(/Fonti consultate/i)).toBeNull();
  });

  it('does not render a sources block or source-rating control when there are 0 sources', () => {
    renderTurn({ turn: successTurn({ retrieved_sources: [] }) });
    expect(screen.queryByText(/Fonti consultate/i)).toBeNull();
    // no per-source relevance buttons (they are aria-labelled "pertinente")
    expect(screen.queryByRole('button', { name: /pertinente/i })).toBeNull();
  });

  it('shows the co-evolution transparency nudge when the answer fed provisional nodes', () => {
    renderTurn({ turn: successTurn({ provisional_candidates: 2 }) });
    expect(screen.getByText(/il grafo sta assorbendo 2 norme recuperate/i)).toBeInTheDocument();
  });

  it('does not show the transparency nudge when nothing new was fed', () => {
    renderTurn({ turn: successTurn({ provisional_candidates: 0 }) });
    expect(screen.queryByText(/il grafo sta assorbendo/i)).toBeNull();
  });
});

describe('QaTurn — teaching gated on canContribute (D2)', () => {
  it('at full consent: rating + source-rating are shown, no upsell', () => {
    renderTurn({ turn: successTurn(), canContribute: true });
    expect(screen.getByRole('button', { name: /risposta utile/i })).toBeInTheDocument();
    // "pertinente" matches both the ✓ and ✗ per-source buttons.
    expect(screen.getAllByRole('button', { name: /pertinente/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/serve il consenso completo/i)).toBeNull();
  });

  it('at basic consent: no rating, no source-rating, shows the upsell that opens the consent dialog', () => {
    const onOpenConsent = vi.fn();
    renderTurn({ turn: successTurn(), canContribute: false, onOpenConsent });
    expect(screen.queryByRole('button', { name: /risposta utile/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /pertinente/i })).toBeNull();
    expect(screen.getByText(/serve il consenso completo/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^attiva$/i }));
    expect(onOpenConsent).toHaveBeenCalled();
    // Asking a follow-up (Approfondisci) stays available at basic consent.
    expect(screen.getByRole('button', { name: /approfondisci/i })).toBeInTheDocument();
  });
});

describe('QaTurn — waiting UX (§3.5)', () => {
  it('shows an elapsed indicator and Annulla while loading', () => {
    const onCancel = vi.fn();
    const turn: QaTurnModel = {
      id: 'turn-load',
      question: 'art 1453?',
      state: { status: 'loading', startedAt: Date.now() - 4000 },
      confirmed: {},
      request: { kind: 'ask', mode: 'convergent' },
    };
    renderTurn({ turn, onCancel });
    expect(screen.getByText(/sta ragionando/i)).toBeInTheDocument();
    expect(screen.getByText(/\d+s/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /annulla/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows no elapsed indicator when startedAt is absent (restored turn)', () => {
    const turn: QaTurnModel = {
      id: 'turn-load',
      question: 'q',
      state: { status: 'loading' },
      confirmed: {},
    };
    renderTurn({ turn });
    expect(screen.queryByText(/^\d+s$/)).toBeNull();
  });
});
