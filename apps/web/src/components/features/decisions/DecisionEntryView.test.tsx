import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DecisionReference, FetchDecisionAnswer } from '../../../types/decisions';

const fetchDecision = vi.fn();
vi.mock('../../../services/decisionService', () => ({ fetchDecision: (...a: unknown[]) => fetchDecision(...a) }));
const addDecisionToHistory = vi.fn();
vi.mock('../../../services/historyService', () => ({ addDecisionToHistory: (...a: unknown[]) => addDecisionToHistory(...a) }));
vi.mock('../dossier/AddToDossierPopover', () => ({ AddToDossierPopover: () => null }));

import { appStore, useAppStore } from '../../../store/useAppStore';
import { fetchDecisionCached, forgetDecision } from '../../../utils/decisionFetchCache';
import { decisionRowKey, type Practice } from '../../../utils/practice';
import { DecisionEntryView } from './DecisionEntryView';

const CIVILE = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 99999, anno: 2024 };
const PENALE = { ...CIVILE, archivio: 'penale' as const };
const AMBIGUA_REF = { corte: 'cassazione' as const, numero: 99999, anno: 2024 };

const foundOf = (identita: DecisionReference, sezione: string, motivazione = 'RITENUTO IN FATTO'): FetchDecisionAnswer => ({
  esito: 'trovata',
  identita,
  attributi: { sezione, tipo: 'sentenza', data_deposito: '2024-03-12' },
  testo: { motivazione },
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

const s = () => appStore.getState();
const practiceOf = (id: string): Practice | undefined => s().practices.find((p) => p.id === id);

/** An entry of the practice, closed, as the dossier's «Apri tutto» adds one: the view is mounted by hand. */
function openEntry(reference: DecisionReference) {
  const { practiceId, decisionId } = s().openDecision(reference, { open: false });
  const entry = () => practiceOf(practiceId)?.decisions.find((d) => d.id === decisionId);
  return { practiceId, decisionId, entry };
}
const entryView = (e: { practiceId: string; decisionId: string }, reference: DecisionReference) => (
  <DecisionEntryView practiceId={e.practiceId} decisionId={e.decisionId} reference={reference} hostId={e.practiceId} />
);

// A small shell: the practice's entries as the table draws them, each from the store's reference.
function Shell({ practiceId }: { practiceId: string }) {
  const decisions = useAppStore((st) => st.practices.find((p) => p.id === practiceId)?.decisions);
  return (
    <>
      {(decisions ?? []).map((d) => (
        <div key={d.id} data-entry={d.id}>
          <DecisionEntryView practiceId={practiceId} decisionId={d.id} reference={d.reference} hostId={practiceId} />
        </div>
      ))}
    </>
  );
}

beforeEach(() => {
  fetchDecision.mockReset();
  addDecisionToHistory.mockReset();
  addDecisionToHistory.mockResolvedValue({});
  for (const ref of [CIVILE, PENALE, AMBIGUA_REF, { ...AMBIGUA_REF, sezione: 'VII' }]) forgetDecision(ref);
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, readingBackStack: [],
    workspaceTabs: [], commandPaletteOpen: false, decisionFocusRequest: null, searchTrigger: null,
  });
});

// jsdom has no layout: an element counts as rendered unless it sits under a [data-copy="hidden"] one
const originalClientRects = HTMLElement.prototype.getClientRects;
beforeEach(() => {
  HTMLElement.prototype.getClientRects = function (this: HTMLElement) {
    return (this.closest('[data-copy="hidden"]') ? [] : [{}]) as unknown as DOMRectList;
  };
});
afterEach(() => {
  HTMLElement.prototype.getClientRects = originalClientRects;
  vi.unstubAllEnvs();
});

describe('DecisionEntryView', () => {
  it('sends the cited section to the route, and the entry learns the identity, its label, the date of deposit and the type', async () => {
    fetchDecision.mockResolvedValue(foundOf(PENALE, '7'));
    const e = openEntry({ ...AMBIGUA_REF, sezione: 'VII' });
    expect(e.entry()).toMatchObject({ identified: false, reference: { ...AMBIGUA_REF, sezione: 'VII' } });
    render(<Shell practiceId={e.practiceId} />);
    expect(await screen.findByText(/Sez\. VII penale · Sentenza n\. 99999\/2024/)).toBeInTheDocument();
    expect(fetchDecision).toHaveBeenCalledWith({ ...AMBIGUA_REF, sezione: 'VII' });
    await waitFor(() => expect(e.entry()?.label).toBe('Cass. pen., sez. VII, n. 99999/2024'));
    expect(e.entry()).toMatchObject({
      reference: PENALE, identified: true, depositDate: '2024-03-12', tipo: 'sentenza', sezione: '7',
    });
  });

  it('opens a candidate in the same entry', async () => {
    fetchDecision.mockImplementation(async (ref: DecisionReference) => (ref.archivio ? foundOf(ref, '7') : AMBIGUOUS));
    const e = openEntry(AMBIGUA_REF);
    render(entryView(e, AMBIGUA_REF));
    fireEvent.click(await screen.findByRole('link', { name: /Sez\. VII penale/ }));
    expect(await screen.findByText(/Sez\. VII penale · Sentenza n\. 99999\/2024/)).toBeInTheDocument();
    await waitFor(() => expect(e.entry()?.reference).toEqual(PENALE));
    expect(practiceOf(e.practiceId)?.decisions).toHaveLength(1);
    expect(fetchDecision).toHaveBeenLastCalledWith(PENALE);
  });

  it('shows nothing of the list once a candidate is chosen, and the entry takes the candidate\'s label only when it answers', async () => {
    let answerCivile: (answer: FetchDecisionAnswer) => void = () => {};
    fetchDecision.mockImplementation((ref: DecisionReference) => {
      if (!ref.archivio) return Promise.resolve(AMBIGUOUS);
      return new Promise((resolve) => { answerCivile = resolve; });
    });
    const e = openEntry(AMBIGUA_REF);
    render(entryView(e, AMBIGUA_REF));
    const labelBefore = e.entry()?.label;
    fireEvent.click(await screen.findByRole('link', { name: /Sez\. III civile/ }));
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(e.entry()?.label).toBe(labelBefore);
    expect(e.entry()?.identified).toBe(false);
    await act(async () => { answerCivile(foundOf(CIVILE, '3')); });
    expect(await screen.findByText(/Sez\. III civile/)).toBeInTheDocument();
    await waitFor(() => expect(e.entry()?.label).toBe('Cass. civ., sez. III, n. 99999/2024'));
  });

  it('an answer that arrives after the row was closed reaches nothing', async () => {
    let answer: (a: FetchDecisionAnswer) => void = () => {};
    fetchDecision.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const e = openEntry(CIVILE);
    const before = e.entry();
    const { unmount } = render(entryView(e, CIVILE));
    unmount();
    await act(async () => { answer(foundOf(CIVILE, '3')); });
    expect(e.entry()).toEqual(before);
  });

  it('«Riprova» after a source that does not answer forgets the answer and fetches again', async () => {
    fetchDecision
      .mockResolvedValueOnce({ esito: 'fonte_non_raggiungibile', fonte: 'cassazione' })
      .mockResolvedValueOnce(foundOf(CIVILE, '3'));
    const e = openEntry(CIVILE);
    render(entryView(e, CIVILE));
    expect(await screen.findByText('La fonte non risponde in questo momento.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText(/Sentenza n\. 99999\/2024/)).toBeInTheDocument();
    expect(fetchDecision).toHaveBeenCalledTimes(2);
  });

  it('a request that never reached the server says so and logs why', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchDecision.mockRejectedValueOnce(new Error('Failed to fetch'));
    const e = openEntry(CIVILE);
    render(entryView(e, CIVILE));
    expect(await screen.findByText('Il server non ha risposto: controlla la connessione e riprova.')).toBeInTheDocument();
    expect(error).toHaveBeenCalledWith('fetch_decision failed', expect.objectContaining({ error: expect.any(Error) }));
    error.mockRestore();
  });

  it('opens the search palette from a refused request', async () => {
    fetchDecision.mockResolvedValue({ esito: 'richiesta_non_valida', errori: { numero: 'Il numero va da 1 a 999999' } });
    const e = openEntry(CIVILE);
    render(entryView(e, CIVILE));
    fireEvent.click(await screen.findByRole('button', { name: 'Cerca nella barra di ricerca' }));
    expect(s().commandPaletteOpen).toBe(true);
    // with the citation typed in, ready to be corrected
    expect(s().commandPaletteQuery).toBe('Cass. civ., n. 99999/2024');
  });

  it('a norm cited in the text opens beside the practice, and the way back names this entry\'s row', async () => {
    vi.stubEnv('VITE_FEATURE_PRACTICE_TABLE', 'true');
    fetchDecision.mockResolvedValue(foundOf(CIVILE, '3', 'Il ricorrente invoca l\'art. 2043 c.c. a torto.'));
    const e = openEntry(CIVILE);
    const { container } = render(entryView(e, CIVILE));
    await screen.findByText(/Sez\. III civile/);
    fireEvent.click(container.querySelector('.citation-hover')!);
    expect(s().searchTrigger).toMatchObject({ article: '2043', besideTabId: e.practiceId });
    expect(s().readingBackStack).toEqual([{
      practiceId: e.practiceId, subject: { kind: 'decision', decisionId: e.decisionId }, place: 'table',
      label: 'Cass. civ., sez. III, n. 99999/2024',
    }]);
  });
});

describe('DecisionEntryView — a candidate that is already an entry', () => {
  it('merges into the entry already there, which takes keyboard focus', async () => {
    fetchDecision.mockImplementation(async (ref: DecisionReference) => (ref.archivio ? foundOf(ref, '7') : AMBIGUOUS));
    // a citation without the archive, then the penal decision cited with it: two entries
    const loose = openEntry(AMBIGUA_REF);
    const penal = openEntry(PENALE);
    expect(penal.decisionId).not.toBe(loose.decisionId);
    // both rows open, as the table draws them
    s().setRowOpen(decisionRowKey(loose.practiceId, loose.decisionId), true);
    s().setRowOpen(decisionRowKey(penal.practiceId, penal.decisionId), true);
    const { container } = render(<Shell practiceId={penal.practiceId} />);
    const penalRow = () => container.querySelector(`[data-entry="${penal.decisionId}"]`) as HTMLElement;
    const looseRow = () => container.querySelector(`[data-entry="${loose.decisionId}"]`) as HTMLElement;
    const penalHeading = await within(penalRow()).findByRole('heading', { level: 4 });
    expect(penalHeading).not.toHaveFocus();

    fireEvent.click(await within(looseRow()).findByRole('link', { name: /Sez\. VII penale/ }));

    await waitFor(() => expect(practiceOf(penal.practiceId)?.decisions.map((d) => d.id)).toEqual([penal.decisionId]));
    await waitFor(() => expect(penalHeading).toHaveFocus());
    expect(s().decisionFocusRequest).toBeNull();
    expect(s().practiceRows[decisionRowKey(penal.practiceId, penal.decisionId)]).toBe(true);
    expect(s().practiceRows[decisionRowKey(penal.practiceId, loose.decisionId)]).toBeUndefined();
  });
});

describe('DecisionEntryView — the row and the window of one decision, both mounted', () => {
  function renderTwoCopies(e: { practiceId: string; decisionId: string }, ref: DecisionReference) {
    return render(
      <>
        <div data-copy="hidden">{entryView(e, ref)}</div>
        <div data-copy="shown">{entryView(e, ref)}</div>
      </>,
    );
  }

  it('gives the focus request to the copy that is on screen, hidden one first in the tree', async () => {
    fetchDecision.mockResolvedValue(foundOf(PENALE, '7'));
    const penal = openEntry(PENALE);
    renderTwoCopies(penal, PENALE);
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(2));
    const [, shownHeading] = screen.getAllByRole('heading', { level: 4 });
    const other = openEntry(CIVILE);
    act(() => { s().setDecisionEntryIdentity(other.practiceId, other.decisionId, PENALE, {}, 'Cass. pen., n. 99999/2024'); });
    await waitFor(() => expect(shownHeading).toHaveFocus());
    expect(s().decisionFocusRequest).toBeNull();
  });

  it('follows the identity the store learns in both copies, not only in the one the reader used', async () => {
    fetchDecision.mockImplementation(async (ref: DecisionReference) => (ref.archivio ? foundOf(ref, '7') : AMBIGUOUS));
    const e = openEntry(AMBIGUA_REF);
    const view = (ref: DecisionReference) => (
      <>
        <div data-copy="hidden">{entryView(e, ref)}</div>
        <div data-copy="shown">{entryView(e, ref)}</div>
      </>
    );
    const { rerender, container } = render(view(AMBIGUA_REF));
    const shown = () => container.querySelector('[data-copy="shown"]') as HTMLElement;
    const hidden = () => container.querySelector('[data-copy="hidden"]') as HTMLElement;
    fireEvent.click(await within(shown()).findByRole('link', { name: /Sez\. VII penale/ }));
    expect(await within(shown()).findByRole('heading', { level: 4 })).toHaveTextContent(/penale/);
    // the store now holds the identity; the entry's reference changes for both copies
    rerender(view(PENALE));
    expect(await within(hidden()).findByRole('heading', { level: 4 })).toHaveTextContent(/penale/);
    expect(within(hidden()).queryAllByRole('link')).toHaveLength(0);
  });
});

describe('DecisionEntryView — the entry learns the identity of a looser reference', () => {
  it('keeps the answer and its notices on screen, with one request and no skeleton after the decision shows', async () => {
    const withNotice: FetchDecisionAnswer = {
      ...foundOf(PENALE, '7'),
      avvisi: [{ tipo: 'archivio_dedotto', archivio: 'penale', sezione: '7' }],
    } as FetchDecisionAnswer;
    fetchDecision.mockResolvedValue(withNotice);
    const e = openEntry({ ...AMBIGUA_REF, sezione: 'VII' });
    render(<Shell practiceId={e.practiceId} />);
    expect(await screen.findByText(/la Sez\. VII indicata è quella penale/)).toBeInTheDocument();
    // the identity lands in the store: the entry's reference is now the bare one
    await waitFor(() => expect(e.entry()?.reference).toEqual(PENALE));
    // from here on, no skeleton may appear
    const statuses: number[] = [];
    const watch = new MutationObserver(() => statuses.push(screen.queryAllByRole('status').length));
    watch.observe(document.body, { childList: true, subtree: true });
    // flush the effects and promise callbacks the identity change sets off, without a real timer
    for (let i = 0; i < 5; i += 1) await act(async () => {});
    watch.disconnect();
    expect(statuses.every((n) => n === 0)).toBe(true);
    expect(screen.getByText(/la Sez\. VII indicata è quella penale/)).toBeInTheDocument();
    expect(fetchDecision).toHaveBeenCalledTimes(1);
    // the answer seeded for the bare identity carries nothing about what was cited
    const seeded = await fetchDecisionCached(PENALE);
    expect(fetchDecision).toHaveBeenCalledTimes(1);
    expect(seeded).toMatchObject({ esito: 'trovata', avvisi: [] });
    expect(screen.getByText(/la Sez\. VII indicata è quella penale/)).toBeInTheDocument();
  });
});

describe('DecisionEntryView — the Cronologia (once per opening, carry-over ruling 13)', () => {
  it('records once per opening: a remount, or the row closed and opened again, never records again', async () => {
    fetchDecision.mockResolvedValue(foundOf(CIVILE, '3'));
    const e = openEntry(CIVILE);
    const first = render(entryView(e, CIVILE));
    await screen.findByText(/Sez\. III civile/);
    expect(addDecisionToHistory).toHaveBeenCalledTimes(1);
    expect(addDecisionToHistory).toHaveBeenCalledWith('cassazione:civile:99999:2024');
    await waitFor(() => expect(e.entry()?.historyRecordedKey).toBe('cassazione:civile:99999:2024'));
    // the row closed (the view unmounts) and opened again, or a reload
    first.unmount();
    render(entryView(e, CIVILE));
    await screen.findByText(/Sez\. III civile/);
    await act(async () => {});
    expect(addDecisionToHistory).toHaveBeenCalledTimes(1);
  });

  it('records again for a new entry of the same decision, added after the old one was taken off the table', async () => {
    fetchDecision.mockResolvedValue(foundOf(CIVILE, '3'));
    const e = openEntry(CIVILE);
    const first = render(entryView(e, CIVILE));
    await screen.findByText(/Sez\. III civile/);
    expect(addDecisionToHistory).toHaveBeenCalledTimes(1);
    first.unmount();
    act(() => { s().removePracticeDecision(e.practiceId, e.decisionId); });
    const again = openEntry(CIVILE);
    expect(again.decisionId).not.toBe(e.decisionId);
    render(entryView(again, CIVILE));
    await waitFor(() => expect(addDecisionToHistory).toHaveBeenCalledTimes(2));
  });

  it('does not record when the decision is opened again into the same practice', async () => {
    fetchDecision.mockResolvedValue(foundOf(CIVILE, '3'));
    const e = openEntry(CIVILE);
    render(entryView(e, CIVILE));
    await screen.findByText(/Sez\. III civile/);
    act(() => { s().openDecision(CIVILE, { beside: false }); });
    await act(async () => {});
    expect(addDecisionToHistory).toHaveBeenCalledTimes(1);
    // drawn again in its row: the key kept on the entry still stops the record
    cleanup();
    render(entryView(e, CIVILE));
    await screen.findByText(/Sez\. III civile/);
    await act(async () => {});
    expect(addDecisionToHistory).toHaveBeenCalledTimes(1);
  });

  it('records the new key when the entry\'s decision is identified (a candidate chosen)', async () => {
    fetchDecision.mockImplementation(async (ref: DecisionReference) => (ref.archivio ? foundOf(ref, '7') : AMBIGUOUS));
    const e = openEntry(AMBIGUA_REF);
    // a key left on the entry by an earlier identity: the new one is still recorded
    act(() => { s().markDecisionEntryRecorded(e.practiceId, e.decisionId, 'cassazione:civile:99999:2024'); });
    render(entryView(e, AMBIGUA_REF));
    fireEvent.click(await screen.findByRole('link', { name: /Sez\. VII penale/ }));
    await waitFor(() => expect(addDecisionToHistory).toHaveBeenCalledTimes(1));
    expect(addDecisionToHistory).toHaveBeenCalledWith('cassazione:penale:99999:2024');
    await waitFor(() => expect(e.entry()?.historyRecordedKey).toBe('cassazione:penale:99999:2024'));
    await act(async () => {});
    expect(addDecisionToHistory).toHaveBeenCalledTimes(1);
  });

  it('a copy that is not on screen records nothing and marks nothing', async () => {
    fetchDecision.mockResolvedValue(foundOf(CIVILE, '3'));
    const e = openEntry(CIVILE);
    render(<div data-copy="hidden">{entryView(e, CIVILE)}</div>);
    await screen.findByText(/Sez\. III civile/);
    await act(async () => {});
    expect(addDecisionToHistory).not.toHaveBeenCalled();
    expect(e.entry()?.historyRecordedKey).toBeUndefined();
  });

  it('records nothing for an answer that is not a found decision', async () => {
    fetchDecision.mockResolvedValue(AMBIGUOUS);
    const e = openEntry(AMBIGUA_REF);
    render(entryView(e, AMBIGUA_REF));
    await screen.findByRole('link', { name: /Sez\. VII penale/ });
    expect(addDecisionToHistory).not.toHaveBeenCalled();
  });

  it('records from the copy on screen only', async () => {
    fetchDecision.mockResolvedValue(foundOf(CIVILE, '3'));
    const e = openEntry(CIVILE);
    render(
      <>
        <div data-copy="hidden">{entryView(e, CIVILE)}</div>
        <div data-copy="shown">{entryView(e, CIVILE)}</div>
      </>,
    );
    await waitFor(() => expect(addDecisionToHistory).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(addDecisionToHistory).toHaveBeenCalledTimes(1);
  });

  it('logs a history failure and still shows the decision', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    addDecisionToHistory.mockRejectedValue(new Error('down'));
    fetchDecision.mockResolvedValue(foundOf(CIVILE, '3'));
    const e = openEntry(CIVILE);
    render(entryView(e, CIVILE));
    expect(await screen.findByText(/Sez\. III civile/)).toBeInTheDocument();
    await waitFor(() => expect(error).toHaveBeenCalledWith('addDecisionToHistory failed', expect.objectContaining({ decisionKey: 'cassazione:civile:99999:2024' })));
    error.mockRestore();
  });
});
