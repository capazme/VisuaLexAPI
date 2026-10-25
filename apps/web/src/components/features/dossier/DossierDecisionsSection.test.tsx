import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { FetchDecisionAnswer } from '../../../types/decisions';

const fetchDecision = vi.fn();
vi.mock('../../../services/decisionService', () => ({ fetchDecision: (...a: unknown[]) => fetchDecision(...a) }));
vi.mock('./AddToDossierPopover', () => ({ AddToDossierPopover: () => null }));
vi.mock('../../../services/assistantService', () => ({
  assistantService: { features: vi.fn(), listProposals: vi.fn(async () => []), setProposalState: vi.fn(), editProposalNote: vi.fn(), removeProposal: vi.fn(), removeProposalOnExit: vi.fn(), refreshForExit: vi.fn(async () => {}) },
}));

import { appStore } from '../../../store/useAppStore';
import { forgetDecision } from '../../../utils/decisionFetchCache';
import type { DossierItem } from '../../../types';
import { DossierDecisionsSection } from './DossierDecisionsSection';
import { DossierDecisionRow } from './DossierDecisionRow';
import { CurrentDossierContext } from './currentDossier';
import { assistantProposalsStore } from '../../../store/assistantProposals';
import { assistantService } from '../../../services/assistantService';
import type { SentenzaItem } from './dossierLayout';

// Stored with labels of an older style: the rows show the citation recomputed (source convention, Q9).
const cass: SentenzaItem = { id: 's1', type: 'sentenza', addedAt: '2026-10-20T10:00:00Z',
  data: { corte: 'cassazione', archivio: 'penale', numero: 99999, anno: 2024, sezione: '7', tipo: 'sentenza',
    data_deposito: '2024-03-12', etichetta: 'Cass. pen. 99999/2024' } };
const cost: SentenzaItem = { id: 's2', type: 'sentenza', addedAt: '', status: 'important',
  data: { corte: 'corte_costituzionale', numero: 1, anno: 2014, etichetta: 'C. cost. 1/2014' } };
const CASS = 'Cass. pen., sez. VII, sent. dep. 12 marzo 2024, n. 99999';
const COST = 'Corte cost., n. 1/2014';

const MOTIVAZIONE = 'RITENUTO IN FATTO\nIl ricorrente lamenta la violazione dell’art. 1218 c.c.';
const found = (testo: Record<string, string>, avvisi: unknown[] = []): FetchDecisionAnswer => ({
  esito: 'trovata',
  identita: { corte: 'cassazione', archivio: 'penale', numero: 99999, anno: 2024 },
  attributi: { sezione: '7', tipo: 'sentenza', data_deposito: '2024-03-12' },
  testo,
  fonte: { nome: 'Corte di cassazione' },
  avvisi,
} as FetchDecisionAnswer);

interface Handlers {
  onRemove?: (item: DossierItem) => void;
  onToggleImportant?: (item: DossierItem) => void;
  showCheckbox?: boolean;
}

/** The section as the page holds it: which rows are open and selected is the page's state. */
function Section({ decisions, onRemove = vi.fn(), onToggleImportant = vi.fn(), showCheckbox = false }: { decisions: SentenzaItem[] } & Handlers) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const flip = (set: Set<string>, id: string) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; };
  return (
    <DossierDecisionsSection
      decisions={decisions}
      expandedIds={expanded}
      onToggleExpand={(id) => setExpanded((s) => flip(s, id))}
      selectedIds={selected}
      showCheckbox={showCheckbox}
      onToggleSelect={(id) => setSelected((s) => flip(s, id))}
      onRemove={onRemove}
      onToggleImportant={onToggleImportant}
    />
  );
}

function Where() { return <span data-testid="where">{useLocation().pathname}</span>; }

const renderSection = (decisions: SentenzaItem[], handlers: Handlers = {}) => render(
  <MemoryRouter initialEntries={['/dossier']}>
    <Where />
    <Routes><Route path="*" element={<Section decisions={decisions} {...handlers} />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  fetchDecision.mockReset();
  forgetDecision({ corte: 'cassazione', archivio: 'penale', numero: 99999, anno: 2024 });
  forgetDecision({ corte: 'corte_costituzionale', numero: 1, anno: 2014 });
  appStore.setState({ searchTrigger: null });
});

describe('DossierDecisionsSection (D7a)', () => {
  it('lists the decisions in their order as rows of the acts\' kind, closed, asking for none', async () => {
    renderSection([cass, cost]);
    const section = screen.getByRole('region', { name: 'Giurisprudenza (2)' });
    const toggles = within(section).getAllByRole('button', { name: /^Espandi / });
    expect(toggles.map((t) => t.getAttribute('aria-label'))).toEqual([`Espandi ${CASS}`, `Espandi ${COST}`]);
    expect(toggles.every((t) => t.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(toggles[0]).toHaveClass('min-h-[44px]');
    expect(within(section).getByText('Aggiunta il 20 ottobre 2026')).toBeInTheDocument();
    // No list of links to a preview any more.
    expect(within(section).queryByRole('link')).toBeNull();
    expect(screen.queryByText('Cass. pen. 99999/2024')).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(fetchDecision).not.toHaveBeenCalled();
  });

  it('reads a decision in place once opened: its text as received, and its address one click away', async () => {
    fetchDecision.mockResolvedValue(found({ motivazione: MOTIVAZIONE }));
    renderSection([cass]);
    fireEvent.click(screen.getByRole('button', { name: `Espandi ${CASS}` }));
    expect(screen.getByRole('button', { name: `Comprimi ${CASS}` })).toHaveAttribute('aria-expanded', 'true');
    const motivazione = await screen.findByRole('region', { name: 'Motivazione' });
    expect(motivazione.textContent).toContain('Il ricorrente lamenta la violazione');
    // The row names it: inside, its full name is a quiet line of details, no second and heavier title.
    const details = screen.getByText(/^Corte di cassazione · Sez\. VII penale · Sentenza n\. 99999\/2024/);
    expect(details.tagName).toBe('P');
    expect(details).toHaveClass('text-sm', 'text-slate-600');
    expect(screen.queryByRole('heading', { name: /^Corte di cassazione/ })).toBeNull();
    // A screen reader still finds the decision by its name: the opened decision is a region named by the row's own
    // citation (no new words on screen), the one the toggle controls.
    const decision = screen.getByRole('region', { name: CASS });
    expect(decision).toContainElement(motivazione);
    expect(screen.getByRole('button', { name: `Comprimi ${CASS}` })).toHaveAttribute('aria-controls', decision.id);
    expect(fetchDecision).toHaveBeenCalledTimes(1);
    // The decision's own reading surface: its toolbar, without the find window it has no tab for.
    expect(screen.getByRole('button', { name: /Glosse sulla decisione/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cerca nel testo/ })).toBeNull();
    const address = screen.getByRole('link', { name: 'Apri la sentenza' });
    expect(address).toHaveAttribute('href', '/sentenze/cassazione-penale/99999/2024');
    fireEvent.click(address);
    expect(screen.getByTestId('where')).toHaveTextContent('/sentenze/cassazione-penale/99999/2024');
  });

  it('opens a decision found without its text and says so, the other rows as they were', async () => {
    fetchDecision.mockResolvedValue(found({}, [{ tipo: 'testo_non_disponibile' }]));
    renderSection([cass, cost]);
    fireEvent.click(screen.getByRole('button', { name: `Espandi ${CASS}` }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Motivazione' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Apri la sentenza' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Espandi ${COST}` })).toHaveAttribute('aria-expanded', 'false');
  });

  it('sends a norm the decision cites to the search page, where the search runs', async () => {
    fetchDecision.mockResolvedValue(found({ motivazione: MOTIVAZIONE }));
    renderSection([cass]);
    fireEvent.click(screen.getByRole('button', { name: `Espandi ${CASS}` }));
    await screen.findByRole('region', { name: 'Motivazione' });
    const cited = await waitFor(() => {
      const link = document.querySelector<HTMLElement>('.citation-hover');
      expect(link).not.toBeNull();
      return link!;
    });
    fireEvent.click(cited);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/));
    expect(appStore.getState().searchTrigger).toEqual(expect.objectContaining({ article: '1218' }));
  });

  it('sends a decision the text cites to the workspace, where its window is drawn', async () => {
    fetchDecision.mockResolvedValue(found({ motivazione: 'Così Corte cost. n. 71/2020, sul punto.' }));
    appStore.setState({ practices: [], activePracticeId: null });
    renderSection([cass]);
    fireEvent.click(screen.getByRole('button', { name: `Espandi ${CASS}` }));
    await screen.findByRole('region', { name: 'Motivazione' });
    const cited = await waitFor(() => {
      const link = document.querySelector<HTMLElement>('.decision-cite');
      expect(link).not.toBeNull();
      return link!;
    });
    fireEvent.click(cited);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/));
    expect(appStore.getState().practices.flatMap((p) => p.decisions.map((d) => d.reference.numero))).toContain(71);
  });

  it('keeps «Apri la sentenza» when the decision was not found', async () => {
    fetchDecision.mockResolvedValue({ esito: 'non_trovata', motivo: 'inesistente' });
    renderSection([cass]);
    fireEvent.click(screen.getByRole('button', { name: `Espandi ${CASS}` }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apri la sentenza' })).toHaveAttribute('href', '/sentenze/cassazione-penale/99999/2024');
  });

  it('asks the source once for an open decision, however often the page redraws', async () => {
    fetchDecision.mockResolvedValue({ esito: 'fonte_non_raggiungibile', fonte: 'cassazione' });
    const { rerender } = renderSection([cass]);
    fireEvent.click(screen.getByRole('button', { name: `Espandi ${CASS}` }));
    await screen.findByRole('alert');
    for (let i = 0; i < 3; i += 1) {
      rerender(
        <MemoryRouter initialEntries={['/dossier']}>
          <Where />
          <Routes><Route path="*" element={<Section decisions={[{ ...cass }]} />} /></Routes>
        </MemoryRouter>,
      );
    }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(fetchDecision).toHaveBeenCalledTimes(1);
  });

  it('stars a decision as an article, and says it is starred', () => {
    const onToggleImportant = vi.fn();
    renderSection([cass, cost], { onToggleImportant });
    const first = screen.getByRole('button', { name: 'Segna come importante' });
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Rimuovi da importanti' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(first);
    expect(onToggleImportant).toHaveBeenCalledWith(cass);
  });

  it('draws no mark of the application that filed a decision, on screen or in the row\'s name (D7b)', () => {
    renderSection([{ ...cass, createdBy: { clientName: 'Claude Code (visualex)' } }, cost]);
    expect(screen.getByRole('button', { name: `Espandi ${CASS}` })).toBeInTheDocument();
    expect(screen.queryByText(/Claude Code/)).toBeNull();
    expect(screen.getByRole('button', { name: `Espandi ${COST}` })).toBeInTheDocument();
  });

  it('shows the traffic light of what an application wrote on a decision, and says it in the row\'s name (D7b)', () => {
    render(
      <DossierDecisionRow
        item={{ ...cass, assistantNotes: { proposed: 1, validated: 2, review: 0 } }} isSelected={false} showCheckbox={false}
        onToggleSelect={() => {}} isExpanded={false} onToggleExpand={() => {}} onRemove={() => {}} onToggleImportant={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: `Espandi ${CASS}, 1 da validare · 2 validati` })).toBeInTheDocument();
    expect(screen.getByTitle('1 da validare · 2 validati')).toHaveAttribute('data-ai-review', 'proposed');
  });

  it('opened in a dossier, its reader asks what an application proposed on that entry (D7b)', async () => {
    fetchDecision.mockResolvedValue(found({ motivazione: MOTIVAZIONE }));
    assistantProposalsStore.setState({ enabled: true, byItem: {} });
    render(
      <MemoryRouter initialEntries={['/dossier']}>
        <CurrentDossierContext.Provider value="d1"><Section decisions={[cass]} /></CurrentDossierContext.Provider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: `Espandi ${CASS}` }));
    await screen.findByRole('region', { name: 'Motivazione' });
    await waitFor(() => expect(assistantService.listProposals).toHaveBeenCalledWith('d1', 's1'));
    assistantProposalsStore.setState({ enabled: false, byItem: {} });
  });

  it('removes a decision as the other rows do', () => {
    const onRemove = vi.fn();
    renderSection([cass], { onRemove });
    fireEvent.click(screen.getByRole('button', { name: `Rimuovi ${CASS} dal dossier` }));
    expect(onRemove).toHaveBeenCalledWith(cass);
  });

  it('takes a checkbox while selecting, as an article does', () => {
    renderSection([cass], { showCheckbox: true });
    const box = screen.getByRole('button', { name: 'Seleziona elemento' });
    fireEvent.click(box);
    expect(screen.getByRole('button', { name: 'Deseleziona elemento' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('draws nothing without decisions', () => {
    const { container } = render(<MemoryRouter><Section decisions={[]} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
