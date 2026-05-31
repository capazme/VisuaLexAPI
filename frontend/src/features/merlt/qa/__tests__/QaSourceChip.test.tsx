import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { QaSourceChip } from '../QaSourceChip';
import { formatRetrievedUrn } from '../format';
import type { QaRetrievedSource } from '../types';

const seed: QaRetrievedSource = {
  urn: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453',
  provenance: 'seed',
  trust: 1.0,
};

function renderChip(source: QaRetrievedSource, confirmState?: 'pending' | 'done' | 'error') {
  return render(
    <MemoryRouter>
      <ul>
        <QaSourceChip source={source} confirmState={confirmState} onConfirm={vi.fn()} onRate={vi.fn()} />
      </ul>
    </MemoryRouter>,
  );
}

describe('QaSourceChip', () => {
  it('shows a readable label + provenance, no remember button for seed', () => {
    renderChip(seed);
    expect(screen.getByText(/art\. 1453/i)).toBeInTheDocument();
    expect(screen.getByText(/fondativa/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ricorda nel grafo/i })).toBeNull();
  });

  it('shows remember button only for live_unconfirmed with node_id', () => {
    renderChip({ urn: 'live:abc', provenance: 'live_unconfirmed', trust: 0.6, node_id: 'live:abc' });
    expect(screen.getByRole('button', { name: /ricorda nel grafo/i })).toBeInTheDocument();
    expect(screen.getByText('provvisoria')).toBeInTheDocument();
  });

  it('links the label to /grafo with the urn', () => {
    renderChip(seed);
    const link = screen.getByRole('link', { name: /art\. 1453/i });
    expect(link.getAttribute('href')).toContain('/grafo?urn=');
  });

  it('formatRetrievedUrn handles massime and live nodes', () => {
    expect(formatRetrievedUrn('massima_cassazione_civile_4022_2018')).toMatch(/Cass\. civ\. 4022\/2018/);
    expect(formatRetrievedUrn('live:abc')).toBe('Fonte provvisoria');
  });

  it('exposes a detail tooltip with URN/provenance (and excerpt when cited)', () => {
    render(
      <MemoryRouter>
        <ul>
          <QaSourceChip
            source={seed}
            cited={{ article_urn: seed.urn, expert: 'literal', relevance: 0.9, excerpt: 'Il debitore...' }}
            onConfirm={vi.fn()}
            onRate={vi.fn()}
          />
        </ul>
      </MemoryRouter>,
    );
    const info = screen.getByRole('button', { name: /dettagli della fonte/i });
    fireEvent.focus(info);
    expect(screen.getByText(/Estratto/i)).toBeInTheDocument();
    expect(screen.getByText(/Il debitore/i)).toBeInTheDocument();
    expect(screen.getByText(seed.urn)).toBeInTheDocument();
  });

});
