import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const loaded = vi.hoisted(() => ({ table: vi.fn(), bar: vi.fn(), phone: vi.fn() }));

vi.mock('../workspace/WorkspaceManager', () => ({ WorkspaceManager: () => <div data-testid="old-workspace" /> }));
vi.mock('../workspace/WorkspaceNavigator', () => ({ WorkspaceNavigator: () => <div data-testid="old-dock" /> }));
vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('./QuickNormsManager', () => ({ QuickNormsManager: () => null }));
vi.mock('../settings/AliasManager', () => ({ AliasManager: () => null }));
vi.mock('./NormaCard', () => ({ NormaCard: () => null }));
vi.mock('../practice/PracticeTable', () => { loaded.table(); return { PracticeTable: () => null }; });
vi.mock('../practice/PracticeBar', () => { loaded.bar(); return { PracticeBar: () => null }; });
vi.mock('../practice/PracticePhoneView', () => { loaded.phone(); return { PracticePhoneView: () => null }; });

import { appStore } from '../../../store/useAppStore';
import { SearchPanel } from './SearchPanel';

// With the flag off (its default) nothing of the practice's table is drawn, nor even loaded
// (controller ruling 2): the old workspace is what `SearchPanel` renders.
describe('SearchPanel with the flag off', () => {
  it('renders the old workspace and never loads the practice table, the bar or the phone\'s table', () => {
    appStore.setState({ workspaceTabs: [], practices: [] });
    appStore.getState().addWorkspaceTab('Codice civile');
    render(<MemoryRouter><SearchPanel /></MemoryRouter>);
    expect(screen.getByTestId('old-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('old-dock')).toBeInTheDocument();
    expect(loaded.table).not.toHaveBeenCalled();
    expect(loaded.bar).not.toHaveBeenCalled();
    expect(loaded.phone).not.toHaveBeenCalled();
  });
});
