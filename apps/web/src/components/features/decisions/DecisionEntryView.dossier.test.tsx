import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FetchDecisionAnswer } from '../../../types/decisions';
import type { DecisionReadingSurfaceProps } from './DecisionReadingSurface';
import type { ParsedCitationData } from '../../../utils/citationMatcher';

const h = vi.hoisted(() => ({ surface: null as null | DecisionReadingSurfaceProps }));
const fetchDecision = vi.fn();
vi.mock('../../../services/decisionService', () => ({ fetchDecision: (...a: unknown[]) => fetchDecision(...a) }));
vi.mock('../../../services/historyService', () => ({ addDecisionToHistory: vi.fn(async () => ({})) }));
vi.mock('../dossier/AddToDossierPopover', () => ({ AddToDossierPopover: () => null }));
// The surface records what the entry gives it: the dossier entry (D7b) and the cited norms (D7d).
vi.mock('./DecisionReadingSurface', () => ({
  DecisionReadingSurface: (p: DecisionReadingSurfaceProps) => { h.surface = p; return <div data-testid="surface" />; },
}));

import { appStore } from '../../../store/useAppStore';
import { forgetDecision } from '../../../utils/decisionFetchCache';
import { ReadingHostContext } from '../practice/readingHost';
import { DecisionEntryView } from './DecisionEntryView';

/** LC58 c5: a decision read in a dossier's «Lettura» has what the dossier's own reader has (D7b, D7d). */

const CASS = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 31310, anno: 2024 };
const FOUND: FetchDecisionAnswer = {
  esito: 'trovata', identita: CASS, attributi: { sezione: '3', tipo: 'sentenza', data_deposito: '2024-03-12' },
  testo: { motivazione: 'RITENUTO IN FATTO' }, fonte: { nome: 'Corte di cassazione' }, avvisi: [],
};
const CC_2043: ParsedCitationData = { act_type: 'codice civile', act_number: '', date: '', article: '2043', confidence: 1 };
const CC_1218 = { ...CC_2043, article: '1218' };
const search = vi.fn();

function entry(host: { dossier?: { id: string } } | null) {
  const { practiceId, decisionId } = appStore.getState().openDecision(CASS, { open: false });
  const view = <DecisionEntryView practiceId={practiceId} decisionId={decisionId} reference={CASS} hostId="win-1" dossierItemId={host?.dossier ? 's1' : undefined} />;
  render(host ? <ReadingHostContext.Provider value={{ search, ...host }}>{view}</ReadingHostContext.Provider> : view);
}

beforeEach(() => {
  h.surface = null;
  search.mockReset();
  fetchDecision.mockReset();
  fetchDecision.mockResolvedValue(FOUND);
  forgetDecision(CASS);
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, readingBackStack: [], searchTrigger: null,
    dossiers: [{
      id: 'dos-1', title: 'Ricorso Rossi', createdAt: '', items: [
        { id: 'n1', addedAt: '', type: 'norma', data: { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043' } },
        { id: 's1', addedAt: '', type: 'sentenza', data: { ...CASS, etichetta: 'Cass. civ., n. 31310/2024' } },
      ],
    }],
  });
});

describe('DecisionEntryView in a dossier\'s «Lettura» (LC58)', () => {
  it('gives the surface its dossier entry, for what an application proposed on it (D7b)', async () => {
    entry({ dossier: { id: 'dos-1' } });
    await screen.findByTestId('surface');
    expect(h.surface?.dossierItemId).toBe('s1');
  });

  it('gives the surface the cited norms (D7d): it knows the dossier\'s, and opens any on the table, beside its window', async () => {
    entry({ dossier: { id: 'dos-1' } });
    await screen.findByTestId('surface');
    const cited = h.surface!.citedNorms!;
    expect(cited.holds(CC_2043)).toBe(true);
    expect(cited.holds(CC_1218)).toBe(false);
    // the preview's button cannot say «Apri in Ricerca» here: the norm lands in the «Lettura»
    expect(cited.elsewhere).toBe('Apri nella Lettura');
    cited.open(CC_1218, null);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ act_type: 'codice civile', article: '1218', version: 'vigente', besideId: 'win-1' }));
  });

  it('in the Corpus: no dossier entry, no cited norms of a host (the surface\'s own search)', async () => {
    entry({});
    await screen.findByTestId('surface');
    expect(h.surface?.dossierItemId).toBeUndefined();
    expect(h.surface?.citedNorms).toBeUndefined();
  });
});
