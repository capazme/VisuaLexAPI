import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// The motion element is replaced by a plain one that records the constraints it was given.
const seen = vi.hoisted(() => ({ constraints: null as null | { left: number; top: number; right: number; bottom: number } }));
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return {
    ...actual,
    motion: { div: ({ children, dragConstraints }: { children: React.ReactNode; dragConstraints: typeof seen.constraints }) => {
      seen.constraints = dragConstraints;
      return <div>{children}</div>;
    } },
  };
});

vi.mock('../decisions/DecisionTabView', () => ({
  DecisionTabView: ({ tabId, reference }: { tabId: string; reference: { numero: number } }) => (
    <div data-testid="decision-tab-view">{tabId}:{reference.numero}</div>
  ),
}));
vi.mock('../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn() }) }));
vi.mock('../../../hooks/useCompare', () => ({ useCompare: () => ({ isOpen: false }) }));

import { appStore } from '../../../store/useAppStore';
import { WorkspaceTabPanel } from './WorkspaceTabPanel';
import { WORKSPACE_AREA_ID } from '../../../utils/workspaceOrigin';

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

  describe('drag limits', () => {
    let rect = { left: 184, top: 32, width: 1096 };
    beforeEach(() => {
      rect = { left: 184, top: 32, width: 1096 };
      // the area is rendered together with the panel (as SearchPanel does on a reload), so it is not
      // in the document during the panel's first render
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        return (this.id === WORKSPACE_AREA_ID ? { ...rect } : { left: 0, top: 0, width: 0 }) as DOMRect;
      });
    });
    afterEach(() => vi.restoreAllMocks());

    const mount = () => {
      const id = appStore.getState().addWorkspaceTab('Codice civile');
      const tab = appStore.getState().workspaceTabs.find((t) => t.id === id)!;
      return render(
        <div id={WORKSPACE_AREA_ID}><WorkspaceTabPanel tab={tab} onViewPdf={noop} onCrossReference={noop} /></div>,
      );
    };

    it('use the origin of the area the panel is laid out in, also on the first mount', () => {
      mount();
      expect(seen.constraints!.top).toBe(-32);
      expect(seen.constraints!.right).toBe(window.innerWidth - 50 - 184);
      expect(seen.constraints!.bottom).toBe(window.innerHeight - 50 - 32);
    });

    it('read the origin again when the drag starts, because the area can move without a resize', () => {
      const { container } = mount();
      rect = { left: 64, top: 32, width: 1216 }; // the sidebar closed
      fireEvent.pointerDown(container.querySelector('.cursor-grab')!);
      expect(seen.constraints!.right).toBe(window.innerWidth - 50 - 64);
    });
  });
});
