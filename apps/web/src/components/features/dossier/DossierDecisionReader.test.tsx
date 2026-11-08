import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DecisionIdentity, FetchDecisionAnswer } from '../../../types/decisions';

const IDENTITY: DecisionIdentity = { corte: 'cassazione', archivio: 'civile', numero: 18266, anno: 2022 };
const FOUND: FetchDecisionAnswer = {
  esito: 'trovata',
  identita: IDENTITY,
  attributi: { sezione: '2', tipo: 'ordinanza', data_deposito: '2022-06-07' },
  testo: { motivazione: "Il ricorrente invoca l'art. 1453 c.c. per la risoluzione del contratto." },
  fonte: { nome: 'Corte di cassazione — archivio pubblico SentenzeWeb (Italgiure)' },
  avvisi: [],
};
// The decision as its court answered it: the reader's own request is `useDecisionAnswer`'s (its tests).
vi.mock('../decisions/useDecisionAnswer', () => ({
  useDecisionAnswer: () => ({ current: IDENTITY, answer: FOUND, retry: vi.fn(), chooseCandidate: vi.fn() }),
}));

import { appStore } from '../../../store/useAppStore';
import { DossierDecisionReader } from './DossierDecisionReader';
import { CitedNormsContext } from './useCitedNorms';

beforeEach(() => {
  appStore.setState({
    searchTrigger: null, highlights: [], annotations: [],
    loadHighlightsForArticle: vi.fn(), loadAnnotationsForArticle: vi.fn(),
  });
});

describe('DossierDecisionReader', () => {
  it('hands the norms its text cites to the dossier (D7d): the link clicked, no search', () => {
    const open = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <CitedNormsContext.Provider value={{ holds: () => false, open }}>
          <DossierDecisionReader identity={IDENTITY} />
        </CitedNormsContext.Provider>
      </MemoryRouter>,
    );
    const link = container.querySelector<HTMLElement>('.vlx-decision .citation-hover')!;
    expect(link).toHaveTextContent('art. 1453 c.c.');
    fireEvent.click(link);
    expect(open).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ act_type: 'codice civile', article: '1453' }), link);
    expect(appStore.getState().searchTrigger).toBeNull();
    expect(screen.getByRole('link', { name: 'Apri la sentenza' })).toBeInTheDocument();
  });

  it('outside a dossier a cited norm is searched, as before', () => {
    const { container } = render(<MemoryRouter><DossierDecisionReader identity={IDENTITY} /></MemoryRouter>);
    fireEvent.click(container.querySelector<HTMLElement>('.vlx-decision .citation-hover')!);
    expect(appStore.getState().searchTrigger).toMatchObject({ act_type: 'codice civile', article: '1453', version: 'vigente' });
  });
});
