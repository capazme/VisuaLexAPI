import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DecisionReference, FetchDecisionAnswer } from '../../../types/decisions';

const fetchDecision = vi.fn();
vi.mock('../../../services/decisionService', () => ({ fetchDecision: (...a: unknown[]) => fetchDecision(...a) }));
vi.mock('../dossier/AddToDossierPopover', () => ({ AddToDossierPopover: () => null }));

import { appStore } from '../../../store/useAppStore';
import { forgetDecision } from '../../../utils/decisionFetchCache';
import { DecisionTabView } from './DecisionTabView';

const CIVILE = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 10787, anno: 2024 };
const PENALE = { ...CIVILE, archivio: 'penale' as const };
const AMBIGUA_REF = { corte: 'cassazione' as const, numero: 10787, anno: 2024 };

const foundOf = (identita: DecisionReference, sezione: string): FetchDecisionAnswer => ({
  esito: 'trovata',
  identita,
  attributi: { sezione, tipo: 'sentenza', data_deposito: '2024-03-12' },
  testo: { motivazione: 'RITENUTO IN FATTO' },
  fonte: { nome: 'Corte di cassazione' },
  avvisi: [],
});
const AMBIGUOUS: FetchDecisionAnswer = {
  esito: 'ambigua',
  candidati: [
    { identita: CIVILE, attributi: { sezione: '3' } },
    { identita: PENALE, attributi: { sezione: '7' } },
  ],
};

function openTab(reference: DecisionReference) {
  const id = appStore.getState().openDecisionTab(reference);
  const tab = () => appStore.getState().workspaceTabs.find((t) => t.id === id)!;
  return { id, tab };
}

beforeEach(() => {
  fetchDecision.mockReset();
  for (const ref of [CIVILE, PENALE, AMBIGUA_REF]) forgetDecision(ref);
  appStore.setState({ workspaceTabs: [], commandPaletteOpen: false });
});

describe('DecisionTabView', () => {
  it('names the tab with the short form, section included, and keeps the section out of the stored reference', async () => {
    fetchDecision.mockResolvedValue(foundOf(PENALE, '7'));
    const { id, tab } = openTab({ ...PENALE, sezione: 'VII' });
    render(<DecisionTabView tabId={id} reference={{ ...PENALE, sezione: 'VII' }} />);
    expect(await screen.findByText(/Sez\. VII penale · Sentenza n\. 10787\/2024/)).toBeInTheDocument();
    await waitFor(() => expect(tab().label).toBe('Cass. pen., sez. VII, n. 10787/2024'));
    expect(tab().view).toEqual({ kind: 'decision', reference: PENALE });
    expect(fetchDecision).toHaveBeenCalledWith({ ...PENALE, sezione: 'VII' });
  });

  it('opens a candidate in the same tab', async () => {
    fetchDecision.mockImplementation(async (ref: DecisionReference) => (ref.archivio ? foundOf(ref, '7') : AMBIGUOUS));
    const { id, tab } = openTab(AMBIGUA_REF);
    render(<DecisionTabView tabId={id} reference={AMBIGUA_REF} />);
    fireEvent.click((await screen.findAllByRole('link'))[1]);
    expect(await screen.findByText(/Sez\. VII penale · Sentenza n\. 10787\/2024/)).toBeInTheDocument();
    await waitFor(() => expect(tab().view).toEqual({ kind: 'decision', reference: PENALE }));
    expect(appStore.getState().workspaceTabs).toHaveLength(1);
    expect(fetchDecision).toHaveBeenLastCalledWith(PENALE);
  });

  it('shows nothing of the list once a candidate is chosen, and the tab takes the candidate\'s label only when it answers', async () => {
    let answerCivile: (answer: FetchDecisionAnswer) => void = () => {};
    fetchDecision.mockImplementation((ref: DecisionReference) => {
      if (!ref.archivio) return Promise.resolve(AMBIGUOUS);
      return new Promise((resolve) => { answerCivile = resolve; });
    });
    const { id, tab } = openTab(AMBIGUA_REF);
    render(<DecisionTabView tabId={id} reference={AMBIGUA_REF} />);
    const labelBefore = tab().label;
    fireEvent.click((await screen.findAllByRole('link'))[0]);
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(tab().label).toBe(labelBefore);
    await act(async () => { answerCivile(foundOf(CIVILE, '3')); });
    expect(await screen.findByText(/Sez\. III civile/)).toBeInTheDocument();
    await waitFor(() => expect(tab().label).toBe('Cass. civ., sez. III, n. 10787/2024'));
  });

  it('an answer that arrives after the tab was closed reaches nothing', async () => {
    let answer: (a: FetchDecisionAnswer) => void = () => {};
    fetchDecision.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const { id, tab } = openTab(CIVILE);
    const labelBefore = tab().label;
    const { unmount } = render(<DecisionTabView tabId={id} reference={CIVILE} />);
    unmount();
    await act(async () => { answer(foundOf(CIVILE, '3')); });
    expect(tab().label).toBe(labelBefore);
  });

  it('«Riprova» after a source that does not answer forgets the answer and fetches again', async () => {
    fetchDecision
      .mockResolvedValueOnce({ esito: 'fonte_non_raggiungibile', fonte: 'cassazione' })
      .mockResolvedValueOnce(foundOf(CIVILE, '3'));
    const { id } = openTab(CIVILE);
    render(<DecisionTabView tabId={id} reference={CIVILE} />);
    expect(await screen.findByText('La fonte non risponde in questo momento.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText(/Sentenza n\. 10787\/2024/)).toBeInTheDocument();
    expect(fetchDecision).toHaveBeenCalledTimes(2);
  });

  it('a request that never reached the server says so and logs why', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchDecision.mockRejectedValueOnce(new Error('Failed to fetch'));
    const { id } = openTab(CIVILE);
    render(<DecisionTabView tabId={id} reference={CIVILE} />);
    expect(await screen.findByText('Il server non ha risposto: controlla la connessione e riprova.')).toBeInTheDocument();
    expect(error).toHaveBeenCalledWith('fetch_decision failed', expect.objectContaining({ error: expect.any(Error) }));
    error.mockRestore();
  });

  it('opens the search palette from a refused request', async () => {
    fetchDecision.mockResolvedValue({ esito: 'richiesta_non_valida', errori: { numero: 'Il numero va da 1 a 999999' } });
    const { id } = openTab(CIVILE);
    render(<DecisionTabView tabId={id} reference={CIVILE} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cerca nella barra di ricerca' }));
    expect(appStore.getState().commandPaletteOpen).toBe(true);
  });
});

describe('DecisionTabView — focus after a merge of two tabs', () => {
  it('takes keyboard focus when the tab the reader was in closed because this one already held the decision', async () => {
    fetchDecision.mockResolvedValue(foundOf(PENALE, '7'));
    const penal = openTab(PENALE);
    render(<DecisionTabView tabId={penal.id} reference={PENALE} />);
    await screen.findByText(/Sez\. VII penale/);
    // a second tab (the civil one) is where the reader chose a candidate: it is the penal decision
    const other = openTab(CIVILE);
    const panel = screen.getByRole('heading', { level: 4 });
    expect(panel).not.toHaveFocus();

    act(() => { appStore.getState().setDecisionTabIdentity(other.id, PENALE, 'Cass. pen., n. 10787/2024'); });

    await waitFor(() => expect(panel).toHaveFocus());
    expect(appStore.getState().decisionFocusRequest).toBeNull();
    // session-only: what the store saves never carries it
    appStore.setState({ decisionFocusRequest: 'some-tab' });
    const saved = appStore.persist.getOptions().partialize!(appStore.getState());
    expect(Object.keys(saved)).not.toContain('decisionFocusRequest');
    appStore.setState({ decisionFocusRequest: null });
    expect(appStore.getState().workspaceTabs.map((t) => t.id)).toEqual([penal.id]);
  });
});
