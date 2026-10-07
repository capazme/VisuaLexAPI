import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SearchDecisionsAnswer } from '../../../types/decisions';

vi.mock('../../../services/decisionSearchService');
import { searchDecisions } from '../../../services/decisionSearchService';
import { appStore } from '../../../store/useAppStore';
import { renderTabView } from '../workspace/renderTabView';
import { DecisionSearchTabView } from './DecisionSearchTabView';
import { clearDecisionSearchCache } from '../../../utils/decisionSearchCache';

const NORMA = { tipo_atto: 'codice civile', numero_articolo: '2043' };
const EMPTY: SearchDecisionsAnswer = { esito: 'risultati', totale: 0, pagina: 1, modo: 'testo', archivio: 'civile', archivio_dal: '2021-01-04', decisioni: [] };
const searchMock = vi.mocked(searchDecisions);
const Wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

beforeEach(() => {
  searchMock.mockReset();
  searchMock.mockResolvedValue(EMPTY);
});

describe('DecisionSearchTabView', () => {
  it('names the topic, the article and the limits', async () => {
    render(<Wrapper><DecisionSearchTabView tabId="t" query={{ tema: 'danno ingiusto', norma: NORMA, normaLabel: 'art. 2043 c.c.' }} /></Wrapper>);
    expect(screen.getByRole('heading', { name: 'Tema: danno ingiusto' })).toBeInTheDocument();
    expect(screen.getByText('e art. 2043 c.c.')).toBeInTheDocument();
    expect(screen.getByText('Solo la Cassazione, ultimi cinque anni; le parole come sono scritte.')).toBeInTheDocument();
    await screen.findByText(/Nessuna decisione/);
  });

  it('«Solo il tema» asks again without the article', async () => {
    render(<Wrapper><DecisionSearchTabView tabId="t" query={{ tema: 'danno ingiusto', norma: NORMA, normaLabel: 'art. 2043 c.c.' }} /></Wrapper>);
    await screen.findByText(/Nessuna decisione/);
    expect(searchMock.mock.calls[0][0]).toMatchObject({ norma: NORMA, tema: 'danno ingiusto' });
    const toggle = screen.getByRole('button', { name: 'Solo il tema' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await vi.waitFor(() => expect(searchMock).toHaveBeenCalledTimes(2));
    expect(searchMock.mock.calls[1][0]).toEqual({ norma: undefined, tema: 'danno ingiusto', archivio: undefined });
    expect(screen.queryByText('e art. 2043 c.c.')).toBeNull();
  });

  it('has no switch for a topic alone', async () => {
    render(<Wrapper><DecisionSearchTabView tabId="t" query={{ tema: 'perdita di chance' }} /></Wrapper>);
    await screen.findByText(/Nessuna decisione/);
    expect(screen.queryByRole('button', { name: 'Solo il tema' })).toBeNull();
  });

  it('is what the workspace draws for a decision-search tab', async () => {
    const id = appStore.getState().openDecisionSearchTab({ tema: 'colpa' }, 'Tema: colpa');
    const tab = appStore.getState().workspaceTabs.find((t) => t.id === id)!;
    render(<Wrapper>{renderTabView(tab, tab.view!)}</Wrapper>);
    expect(screen.getByRole('heading', { name: 'Tema: colpa' })).toBeInTheDocument();
    await screen.findByText(/Nessuna decisione/);
  });
});

beforeEach(() => clearDecisionSearchCache());
