import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../workspace/WorkspaceManager', () => ({ WorkspaceManager: () => null }));
vi.mock('../workspace/WorkspaceNavigator', () => ({ WorkspaceNavigator: () => null }));
vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('./QuickNormsManager', () => ({ QuickNormsManager: () => null }));
vi.mock('../settings/AliasManager', () => ({ AliasManager: () => null }));
vi.mock('./ReadingBackControl', () => ({ ReadingBackControl: () => null }));
vi.mock('./NormaCard', () => ({ NormaCard: () => null }));
vi.mock('../decisions/DecisionTabView', () => ({ DecisionTabView: () => null }));

import { appStore } from '../../../store/useAppStore';
import { SearchPanel } from './SearchPanel';

const REF = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 10787, anno: 2024 };
const decisionTabs = () => appStore.getState().workspaceTabs.filter((t) => t.view?.kind === 'decision');

beforeEach(() => appStore.setState({ workspaceTabs: [], pendingDecision: null }));

// The `/sentenze/…` address queues a decision and redirects: the panel may mount before or after
// the request, and StrictMode runs every effect twice.
describe('SearchPanel — a decision asked for from outside', () => {
  it('opens it once when the request was there before the panel mounted', () => {
    appStore.getState().requestOpenDecision(REF);
    render(<StrictMode><MemoryRouter><SearchPanel /></MemoryRouter></StrictMode>);
    expect(decisionTabs()).toHaveLength(1);
    expect(appStore.getState().pendingDecision).toBeNull();
  });

  it('opens it once when the request comes after the panel mounted', () => {
    render(<StrictMode><MemoryRouter><SearchPanel /></MemoryRouter></StrictMode>);
    expect(decisionTabs()).toHaveLength(0);
    act(() => { appStore.getState().requestOpenDecision(REF); });
    expect(decisionTabs()).toHaveLength(1);
    expect(appStore.getState().pendingDecision).toBeNull();
  });
});
