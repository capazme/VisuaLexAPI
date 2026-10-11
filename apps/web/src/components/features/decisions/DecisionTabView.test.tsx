import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { DecisionReference, FetchDecisionAnswer } from '../../../types/decisions';

const fetchDecision = vi.fn();
vi.mock('../../../services/decisionService', () => ({ fetchDecision: (...a: unknown[]) => fetchDecision(...a) }));
const addDecisionToHistory = vi.fn();
vi.mock('../../../services/historyService', () => ({ addDecisionToHistory: (...a: unknown[]) => addDecisionToHistory(...a) }));
vi.mock('../dossier/AddToDossierPopover', () => ({ AddToDossierPopover: () => null }));

import { appStore } from '../../../store/useAppStore';
import { forgetDecision } from '../../../utils/decisionFetchCache';
import { renderTabView } from '../workspace/renderTabView';

// The old surface's decision tab, until P6 deletes it: a thin wrapper over `useDecisionAnswer` and
// `DecisionEntryView`'s body. The fetch, the candidates, the notices, the hand-off, the focus and the
// Cronologia are tested once, on the entry (`DecisionEntryView.test.tsx`); this case checks the
// wrapper wires them to the tab.
const CIVILE = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 99999, anno: 2024 };
const PENALE = { ...CIVILE, archivio: 'penale' as const };
const CITED = { corte: 'cassazione' as const, numero: 99999, anno: 2024, sezione: 'VII' };

const foundOf = (identita: DecisionReference, sezione: string): FetchDecisionAnswer => ({
  esito: 'trovata',
  identita,
  attributi: { sezione, tipo: 'sentenza', data_deposito: '2024-03-12' },
  testo: { motivazione: 'RITENUTO IN FATTO' },
  fonte: { nome: 'Corte di cassazione' },
  avvisi: [],
});

const originalClientRects = HTMLElement.prototype.getClientRects;
beforeEach(() => {
  fetchDecision.mockReset();
  addDecisionToHistory.mockReset();
  addDecisionToHistory.mockResolvedValue({});
  for (const ref of [CIVILE, PENALE, CITED]) forgetDecision(ref);
  appStore.setState({ workspaceTabs: [], commandPaletteOpen: false, decisionFocusRequest: null });
  // jsdom has no layout: every element counts as rendered
  HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
});
afterEach(() => { HTMLElement.prototype.getClientRects = originalClientRects; });

describe('DecisionTabView (the old tab, until P6)', () => {
  it('draws the entry view for a decision tab: the tab learns the identity and its label, and the Cronologia is told once', async () => {
    fetchDecision.mockResolvedValue(foundOf(PENALE, '7'));
    const id = appStore.getState().openDecisionTab(CITED);
    const tab = () => appStore.getState().workspaceTabs.find((t) => t.id === id)!;
    render(<>{renderTabView(tab(), tab().view!)}</>);
    expect(await screen.findByText(/Sez\. VII penale · Sentenza n\. 99999\/2024/)).toBeInTheDocument();
    expect(fetchDecision).toHaveBeenCalledWith(CITED);
    await waitFor(() => expect(tab().label).toBe('Cass. pen., sez. VII, n. 99999/2024'));
    expect(tab().view).toEqual({ kind: 'decision', reference: PENALE });
    await waitFor(() => expect(tab().historyRecordedKey).toBe('cassazione:penale:99999:2024'));
    expect(addDecisionToHistory).toHaveBeenCalledTimes(1);
    expect(addDecisionToHistory).toHaveBeenCalledWith('cassazione:penale:99999:2024');
  });
});
