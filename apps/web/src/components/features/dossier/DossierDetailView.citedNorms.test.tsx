import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ParsedCitationData } from '../../../utils/citationMatcher';

vi.mock('./useActDetails', () => ({
  useActDetails: () => ({ title: null, rubricaOf: () => null }),
  resolveBlockUrn: async () => 'urn:act',
  lastActTitle: () => null,
}));
vi.mock('../../../utils/actStructureCache', () => ({ fetchActRubriche: async () => ({ title: 'Titolo' }) }));
vi.mock('./DossierItemReader', () => ({ DossierItemReader: () => null }));
vi.mock('../../../services/taskService', () => ({
  taskService: { list: async () => ({ today: '2026-10-24', tasks: [], truncated: false }) },
}));
vi.mock('../../../services/dossierService', () => ({
  dossierService: { getSnapshots: vi.fn(async () => []), writesInFlight: vi.fn(() => 0) },
}));
// The cited norm as the source answers it, for «Aggiungi al dossier».
const fetched = vi.hoisted(() => ({ fetchArticleForNorma: vi.fn() }));
vi.mock('../../../utils/articleFetchCache', () => fetched);
// The dossiers to add to: what it is handed is what is tested here (its own tests: `AddToDossierPopover.test.tsx`).
vi.mock('./AddToDossierPopover', () => ({
  AddToDossierPopover: ({ norma }: { norma: { tipo_atto: string; numero_articolo: string } }) => (
    <div role="dialog" aria-label="Scegli il dossier">{`${norma.tipo_atto} art. ${norma.numero_articolo}`}</div>
  ),
}));

// The decision's reader, reduced to the links its text draws: what it hands the page is the reading surface's
// (`DecisionReadingSurface.test.tsx`); the page's answer is what is tested here.
const CITED = vi.hoisted(() => ({
  held: { act_type: 'legge', act_number: '247', date: '2012', article: '3', confidence: 0.95 },
  absent: { act_type: 'codice civile', article: '2043', confidence: 0.95 },
}));
vi.mock('./DossierDecisionReader', async () => {
  const { useContext } = await import('react');
  const { CitedNormsContext } = await import('./useCitedNorms');
  return {
    DossierDecisionReader: () => {
      const cited = useContext(CitedNormsContext);
      const link = (citation: ParsedCitationData, words: string) => (
        <span className="citation-hover" onClick={(event) => cited?.open(citation, event.currentTarget)}>{words}</span>
      );
      return (
        <div data-testid="decision-text">
          {link(CITED.held, 'art. 3 l. 247/2012')} {link(CITED.absent, 'art. 2043 c.c.')}
          <button type="button" onClick={() => cited?.open(CITED.held, null)}>anteprima: art. 3</button>
          <button type="button" onClick={() => cited?.open(CITED.absent, null)}>anteprima: art. 2043</button>
          <span>{cited?.holds(CITED.held) ? 'art. 3 nel dossier' : ''}</span>
        </div>
      );
    },
  };
});

import { appStore } from '../../../store/useAppStore';
import { DossierDetailView } from './DossierDetailView';
import type { Dossier } from '../../../types';

const L247 = 'l. 31 dicembre 2012, n. 247';
const L49 = 'l. 21 aprile 2023, n. 49';
const CITATION = 'Corte cost., sent. 13 gennaio 2014, n. 1';
const dossier: Dossier = {
  id: 'd1', title: 'Ricorso Rossi', createdAt: '2026-10-04T08:00:00Z', tags: [],
  items: [
    { id: 'b1', type: 'norma', addedAt: '', actCitation: L49, data: { tipo_atto: 'legge', numero_atto: '49', data: '2023-04-21', numero_articolo: '1' } },
    { id: 'a3', type: 'norma', addedAt: '', actCitation: L247, citation: `art. 3, ${L247}`, data: { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', numero_articolo: '3' } },
    { id: 's1', type: 'sentenza', addedAt: '', data: { corte: 'corte_costituzionale', numero: 1, anno: 2014, tipo: 'sentenza', data_deposito: '2014-01-13', etichetta: 'x' } },
  ],
};

function renderView(start: Dossier = dossier) {
  appStore.setState({ dossiers: [structuredClone(start)], pendingDossierItemIds: {}, pendingDossierOrders: {}, searchTrigger: null });
  render(
    <MemoryRouter initialEntries={['/dossier/d1']}>
      <Routes>
        <Route path="/dossier/:id" element={<DossierDetailView dossier={appStore.getState().dossiers[0]} onBack={() => {}} showToast={() => {}} />} />
        <Route path="/" element={<p>Dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );
  // The decision opened in place, its text drawn.
  fireEvent.click(screen.getByRole('button', { name: `Espandi ${CITATION}` }));
  return screen.getByTestId('decision-text');
}

const articleToggle = () => within(screen.getByRole('region', { name: L247 })).queryByRole('button', { name: /art\. 3, / });

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('a norm a decision cites, in the dossier (D7d)', () => {
  it('opens it in the norms’ column: its row opens, takes the focus and glows; the page stays', () => {
    const text = renderView();
    expect(articleToggle()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(within(text).getByText('art. 3 l. 247/2012'));
    const toggle = articleToggle()!;
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveFocus();
    expect(toggle.closest('[data-dossier-item]')).toHaveClass('ring-2', 'ring-amber-400');
    expect(appStore.getState().searchTrigger).toBeNull();
    expect(screen.queryByText('Dashboard')).toBeNull();
    // the decision is still open, where it was
    expect(screen.getByTestId('decision-text')).toBe(text);
  });

  it('stops the glow after a moment', () => {
    vi.useFakeTimers();
    try {
      const text = renderView();
      fireEvent.click(within(text).getByText('art. 3 l. 247/2012'));
      const row = articleToggle()!.closest('[data-dossier-item]')!;
      expect(row).toHaveClass('ring-2');
      act(() => { vi.advanceTimersByTime(1600); });
      expect(row).not.toHaveClass('ring-2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('unfolds its act when it is folded, and leaves it to the user to fold again', () => {
    const text = renderView();
    const act247 = screen.getByRole('region', { name: L247 });
    fireEvent.click(within(act247).getByRole('button', { expanded: true, name: L247 }));
    expect(articleToggle()).toBeNull();
    fireEvent.click(within(text).getByText('art. 3 l. 247/2012'));
    expect(articleToggle()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(within(act247).getByRole('button', { expanded: true, name: L247 }));
    expect(articleToggle()).toBeNull();
  });

  it('clears the page’s search that hides it', () => {
    renderView();
    const search = screen.getByRole('textbox', { name: 'Cerca negli elementi del dossier' });
    // the decision alone on screen, the acts still mounted
    fireEvent.change(search, { target: { value: 'Corte' } });
    expect(screen.queryByRole('region', { name: L247 })).toBeNull();
    fireEvent.click(within(screen.getByTestId('decision-text')).getByText('art. 3 l. 247/2012'));
    expect(search).toHaveValue('');
    expect(articleToggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens it from the preview’s button too, and says the dossier holds it', () => {
    const text = renderView();
    expect(within(text).getByText('art. 3 nel dossier')).toBeInTheDocument();
    fireEvent.click(within(text).getByRole('button', { name: 'anteprima: art. 3' }));
    expect(articleToggle()).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('a norm a decision cites, not in the dossier (D7d)', () => {
  it('opens nothing by itself: it offers Dashboard or a dossier, by the link', async () => {
    const text = renderView();
    fireEvent.click(within(text).getByText('art. 2043 c.c.'));
    const choice = screen.getByRole('dialog', { name: /art\. 2043 .* non è in questo dossier\./ });
    expect(appStore.getState().searchTrigger).toBeNull();
    await waitFor(() => expect(within(choice).getByRole('button', { name: 'Apri su Dashboard' })).toHaveFocus());
    expect(within(choice).getByRole('button', { name: 'Aggiungi al dossier' })).toBeInTheDocument();
  });

  it('«Apri su Dashboard» searches its text in force there, as before', () => {
    const text = renderView();
    fireEvent.click(within(text).getByText('art. 2043 c.c.'));
    fireEvent.click(screen.getByRole('button', { name: 'Apri su Dashboard' }));
    expect(appStore.getState().searchTrigger).toEqual({ act_type: 'codice civile', act_number: '', date: '', article: '2043', version: 'vigente' });
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('«Aggiungi al dossier» reads the norm from the source, then offers the dossiers', async () => {
    fetched.fetchArticleForNorma.mockResolvedValue({ norma_data: { tipo_atto: 'codice civile', data: '1942-03-16', numero_articolo: '2043', urn: 'urn:cc:2043' } });
    const text = renderView();
    fireEvent.click(within(text).getByText('art. 2043 c.c.'));
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi al dossier' }));
    expect(fetched.fetchArticleForNorma).toHaveBeenCalledExactlyOnceWith({ tipo_atto: 'codice civile', numero_atto: '', data: '', numero_articolo: '2043' });
    expect(await screen.findByRole('dialog', { name: 'Scegli il dossier' })).toHaveTextContent('codice civile art. 2043');
  });

  it('says so when the source does not answer, and keeps both ways open', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetched.fetchArticleForNorma.mockRejectedValue(new Error('Testo non disponibile'));
    const text = renderView();
    fireEvent.click(within(text).getByText('art. 2043 c.c.'));
    // the dialog's own first focus, then the keyboard's on «Aggiungi al dossier»
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apri su Dashboard' })).toHaveFocus());
    const add = screen.getByRole('button', { name: 'Aggiungi al dossier' });
    add.focus();
    fireEvent.click(add);
    // read: the button says so and keeps the focus
    expect(screen.getByRole('button', { name: 'Cerco la norma…' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Cerco la norma…' })).toHaveFocus();
    expect(await screen.findByRole('alert')).toHaveTextContent('Non riesco a leggere la norma citata: riprova, o aprila su Dashboard.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aggiungi al dossier' })).toHaveAttribute('aria-disabled', 'false'));
    expect(screen.getByRole('button', { name: 'Aggiungi al dossier' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Apri su Dashboard' })).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const text = renderView();
    fireEvent.click(within(text).getByText('art. 2043 c.c.'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Apri su Dashboard' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the preview’s «Apri nella pratica», a choice already, goes to Dashboard', () => {
    const text = renderView();
    fireEvent.click(within(text).getByRole('button', { name: 'anteprima: art. 2043' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(appStore.getState().searchTrigger).toMatchObject({ act_type: 'codice civile', article: '2043' });
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});

describe('the columns (D7d)', () => {
  it('from lg each column of two scrolls on its own, as tall as the window', () => {
    renderView();
    const norms = screen.getByRole('region', { name: 'Norme' });
    const decisions = screen.getByRole('region', { name: 'Giurisprudenza (1)' }).parentElement!;
    for (const column of [norms, decisions]) expect(column).toHaveClass('lg:max-h-app-column', 'lg:overflow-y-auto');
  });

  it('one kind alone keeps one column, scrolling with the page', () => {
    appStore.setState({ dossiers: [structuredClone({ ...dossier, items: dossier.items.filter((i) => i.type === 'norma') })] });
    render(<MemoryRouter><DossierDetailView dossier={appStore.getState().dossiers[0]} onBack={() => {}} showToast={() => {}} /></MemoryRouter>);
    expect(screen.queryByRole('region', { name: 'Norme' })).toBeNull();
    expect(screen.getByRole('region', { name: L247 }).closest('.lg\\:overflow-y-auto')).toBeNull();
  });
});
