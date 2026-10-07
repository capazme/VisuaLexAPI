import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../decisions/DecisionTabView', () => ({
  DecisionTabView: ({ tabId, reference }: { tabId: string; reference: { numero: number } }) => (
    <div data-testid="decision-tab-view">{tabId}:{reference.numero}</div>
  ),
}));
vi.mock('../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn() }) }));
vi.mock('../../../hooks/useCompare', () => ({ useCompare: () => ({ isOpen: false }) }));

import { appStore } from '../../../store/useAppStore';
import { WorkspaceTabPanel } from './WorkspaceTabPanel';

const REF = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 10787, anno: 2024 };
const noop = () => {};

beforeEach(() => appStore.setState({ workspaceTabs: [], pendingDecision: null }));

describe('WorkspaceTabPanel with a decision tab', () => {
  it('draws the decision, not the empty-tab hint, and hides what applies to articles only', () => {
    const id = appStore.getState().openDecisionTab(REF);
    const tab = appStore.getState().workspaceTabs.find((t) => t.id === id)!;
    render(<WorkspaceTabPanel tab={tab} onViewPdf={noop} onCrossReference={noop} />);
    expect(screen.getByTestId('decision-tab-view')).toHaveTextContent(`${id}:10787`);
    expect(screen.queryByText('Tab vuota')).toBeNull();
    expect(screen.queryByTitle('Aggiungi a dossier')).toBeNull();
    expect(screen.queryByTitle('Modifica nome')).toBeNull();
    // what works for every tab stays
    expect(screen.getByTitle('Chiudi')).toBeInTheDocument();
    expect(screen.getByTitle('Minimizza')).toBeInTheDocument();
  });

  it('keeps the collection button and the rename on an article tab', () => {
    const id = appStore.getState().addWorkspaceTab('Codice civile');
    const tab = appStore.getState().workspaceTabs.find((t) => t.id === id)!;
    render(<WorkspaceTabPanel tab={tab} onViewPdf={noop} onCrossReference={noop} />);
    expect(screen.getByTitle('Aggiungi a dossier')).toBeInTheDocument();
    expect(screen.getByTitle('Modifica nome')).toBeInTheDocument();
    expect(screen.getByText('Tab vuota')).toBeInTheDocument();
  });
});
