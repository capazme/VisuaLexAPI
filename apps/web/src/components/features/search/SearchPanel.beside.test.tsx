import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../workspace/WorkspaceManager', () => ({ WorkspaceManager: () => null }));
vi.mock('../workspace/WorkspaceNavigator', () => ({ WorkspaceNavigator: () => null }));
vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('./QuickNormsManager', () => ({ QuickNormsManager: () => null }));
vi.mock('../settings/AliasManager', () => ({ AliasManager: () => null }));
vi.mock('./ReadingBackControl', () => ({ ReadingBackControl: () => null }));
vi.mock('./NormaCard', () => ({ NormaCard: () => null }));
vi.mock('../decisions/DecisionTabView', () => ({ DecisionTabView: () => null }));
vi.mock('../../../services/historyService', () => ({ addToHistory: vi.fn().mockResolvedValue(undefined) }));

const article = {
  article_text: 'Chiunque cagiona ad altri un danno ingiusto.',
  norma_data: { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '2043', urn: 'urn:nir:stato:regio.decreto:1942-03-16;262~art2043', url: 'urn:nir:stato:regio.decreto:1942-03-16;262' },
  brocardi_info: null,
};
vi.mock('../../../services/legalFetch', () => ({
  legalFetch: async () => new Response(JSON.stringify(article) + '\n'),
}));

import { appStore } from '../../../store/useAppStore';
import { SearchPanel } from './SearchPanel';

const PARAMS = { act_type: 'codice civile', act_number: '', date: '', article: '2043', version: 'vigente' as const, show_brocardi_info: false };

beforeEach(() => appStore.setState({ workspaceTabs: [], searchTrigger: null }));

describe('SearchPanel — a search started from another tab', () => {
  it('puts the tab that holds the result beside the asking tab, the asking tab on the left', async () => {
    const host = appStore.getState().openDecisionTab({ corte: 'cassazione', archivio: 'civile', numero: 1, anno: 2024 });
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    act(() => { appStore.getState().triggerSearch({ ...PARAMS, besideTabId: host }); });
    await waitFor(() => expect(appStore.getState().workspaceTabs).toHaveLength(2));
    const tabs = appStore.getState().workspaceTabs;
    const left = tabs.find((t) => t.id === host)!;
    const right = tabs.find((t) => t.id !== host)!;
    expect(right.content).toHaveLength(1);
    expect(left.size.width).toBe(right.size.width);
    expect(left.position.x).toBeLessThan(right.position.x);
  });

  it('leaves the layout alone for a search that names no tab', async () => {
    const host = appStore.getState().openDecisionTab({ corte: 'cassazione', archivio: 'civile', numero: 1, anno: 2024 });
    const before = { ...appStore.getState().workspaceTabs.find((t) => t.id === host)!.size };
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    act(() => { appStore.getState().triggerSearch(PARAMS); });
    await waitFor(() => expect(appStore.getState().workspaceTabs).toHaveLength(2));
    expect(appStore.getState().workspaceTabs.find((t) => t.id === host)!.size).toEqual(before);
  });
});
