import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { DossierDecisionsSection } from './DossierDecisionsSection';
import type { SentenzaItem } from './dossierLayout';

const fetchDecisionCached = vi.fn<(ref: unknown) => Promise<unknown>>(() => Promise.resolve({ esito: 'non_trovata', motivo: 'inesistente' }));
vi.mock('../../../utils/decisionFetchCache', () => ({ fetchDecisionCached: (ref: unknown) => fetchDecisionCached(ref) }));

// Stored with labels of an older style: the rows show the citation recomputed (source convention, Q9).
const cass: SentenzaItem = { id: 's1', type: 'sentenza', addedAt: '',
  data: { corte: 'cassazione', archivio: 'penale', numero: 99999, anno: 2024, sezione: '7', tipo: 'sentenza',
    data_deposito: '2024-03-12', etichetta: 'Cass. pen. 99999/2024' } };
const cost: SentenzaItem = { id: 's2', type: 'sentenza', addedAt: '',
  data: { corte: 'corte_costituzionale', numero: 1, anno: 2014, etichetta: 'C. cost. 1/2014' } };

describe('DossierDecisionsSection', () => {
  it('lists the decisions in their order, each citation a link to its address', () => {
    render(<MemoryRouter><DossierDecisionsSection decisions={[cass, cost]} onRemove={vi.fn()} /></MemoryRouter>);
    const section = screen.getByRole('region', { name: 'Giurisprudenza (2)' });
    const links = within(section).getAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Cass. pen., sez. VII, sent. dep. 12 marzo 2024, n. 99999', '/sentenze/cassazione-penale/99999/2024'],
      ['Corte cost., n. 1/2014', '/sentenze/corte-costituzionale/1/2014'],
    ]);
    expect(screen.queryByText('Cass. pen. 99999/2024')).toBeNull();
  });

  it('previews a decision on a click, and goes to its address from the preview', async () => {
    function Where() { return <span data-testid="where">{useLocation().pathname}</span>; }
    render(
      <MemoryRouter initialEntries={['/dossier']}>
        <Where />
        <Routes><Route path="*" element={<DossierDecisionsSection decisions={[cost]} onRemove={vi.fn()} />} /></Routes>
      </MemoryRouter>,
    );
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: 'Corte cost., n. 1/2014' })); });
    expect(fetchDecisionCached).toHaveBeenCalledWith({ corte: 'corte_costituzionale', numero: 1, anno: 2014 });
    expect(screen.getByTestId('where')).toHaveTextContent('/dossier');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Apri la sentenza' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/sentenze/corte-costituzionale/1/2014');
  });

  it('removes a decision as the other rows do', () => {
    const onRemove = vi.fn();
    render(<MemoryRouter><DossierDecisionsSection decisions={[cass]} onRemove={onRemove} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi Cass. pen., sez. VII, sent. dep. 12 marzo 2024, n. 99999 dal dossier' }));
    expect(onRemove).toHaveBeenCalledWith(cass);
  });

  it('draws nothing without decisions', () => {
    const { container } = render(<MemoryRouter><DossierDecisionsSection decisions={[]} onRemove={vi.fn()} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
