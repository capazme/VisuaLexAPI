import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../workspace/WorkspaceManager', () => ({ WorkspaceManager: () => null }));
vi.mock('../workspace/WorkspaceNavigator', () => ({ WorkspaceNavigator: () => null }));
vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('./QuickNormsManager', () => ({ QuickNormsManager: () => null }));
vi.mock('../settings/AliasManager', () => ({ AliasManager: () => null }));
vi.mock('./ReadingBackControl', () => ({ ReadingBackControl: () => null }));
vi.mock('./NormaCard', () => ({ NormaCard: () => null }));
vi.mock('../decisions/DecisionTabView', () => ({
  DecisionTabView: ({ reference }: { reference: { numero: number } }) => <div data-testid="decision">n. {reference.numero}</div>,
}));

import { appStore } from '../../../store/useAppStore';
import { SearchPanel } from './SearchPanel';

const REF = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 10787, anno: 2024 };

beforeEach(() => appStore.setState({ workspaceTabs: [], pendingDecision: null }));

describe('SearchPanel on a phone', () => {
  // the tab area animates one tab out before the next in: the new one is awaited
  it('shows a decision that has just been opened, and leaves the reader\'s own swipe alone', async () => {
    appStore.getState().addWorkspaceTab('Codice civile');
    appStore.getState().addWorkspaceTab('Codice penale');
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    expect(screen.queryByTestId('decision')).toBeNull();

    act(() => { appStore.getState().openDecisionTab(REF); });
    expect(await screen.findByTestId('decision')).toHaveTextContent('n. 10787');
    expect(screen.getByText('Cass. civ., n. 10787/2024')).toBeInTheDocument(); // the header names it

    // the reader goes back to the first tab (the previous-tab chevron is the first button)
    fireEvent.click(screen.getAllByRole('button')[0]);
    fireEvent.click(screen.getAllByRole('button')[0]);
    await waitFor(() => expect(screen.queryByTestId('decision')).toBeNull());
    expect(screen.getByText('Codice civile')).toBeInTheDocument();

    // a later change to the store does not pull the reader back to the decision
    act(() => { appStore.getState().addWorkspaceTab('Codice di procedura'); });
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByTestId('decision')).toBeNull();
    expect(screen.getByText('Codice civile')).toBeInTheDocument();
  });
});
