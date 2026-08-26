import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The tour hook fires timers and writes to localStorage on mount; neither is
// what this test is about.
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true }),
}));

import { appStore } from '../../../store/useAppStore';
import { TreeViewPanel } from './TreeViewPanel';

const originalMatchMedia = window.matchMedia;

/** The shared setup shim answers `false` to every query; these tests need both. */
function setViewport(isDesktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isDesktop,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  appStore.setState({
    structureWindow: { blockId: 'block-a', position: { x: 120, y: 80 } },
  });
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('TreeViewPanel — window variant', () => {
  beforeEach(() => setViewport(true));

  it('renders the index outside its own subtree, on document.body', () => {
    const { container } = render(
      <TreeViewPanel
        variant="window"
        isOpen
        onClose={vi.fn()}
        treeData={['1', '2']}
        urn="urn:test"
        title="Struttura Atto"
      />,
    );

    // Portalled out: nothing lands in the component's own container, which is
    // the whole point — the workspace panel it lives under is transformed.
    expect(container).toBeEmptyDOMElement();
    expect(screen.getByText('Struttura Atto')).toBeInTheDocument();
  });

  it('stays open after an article is picked', () => {
    const onArticleSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <TreeViewPanel
        variant="window"
        isOpen
        onClose={onClose}
        treeData={['1', '2']}
        urn="urn:test"
        onArticleSelect={onArticleSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '1' }));

    expect(onArticleSelect).toHaveBeenCalledWith('1', null);
    // Picking must not dismiss the window: taking several articles out of one
    // index without reopening it is the point of the round.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
  });

  it('renders nothing on a small viewport, so the portal cannot leak onto mobile', () => {
    setViewport(false);

    render(
      <TreeViewPanel
        variant="window"
        isOpen
        onClose={vi.fn()}
        treeData={['1']}
        urn="urn:test"
        title="Struttura Atto"
      />,
    );

    expect(screen.queryByText('Struttura Atto')).not.toBeInTheDocument();
  });

  it('renders nothing while closed', () => {
    render(
      <TreeViewPanel
        variant="window"
        isOpen={false}
        onClose={vi.fn()}
        treeData={['1']}
        urn="urn:test"
        title="Struttura Atto"
      />,
    );

    expect(screen.queryByText('Struttura Atto')).not.toBeInTheDocument();
  });
});

describe('TreeViewPanel — drawer variant', () => {
  beforeEach(() => setViewport(false));

  it('renders in place rather than through a portal', () => {
    const { container } = render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={vi.fn()}
        treeData={['1']}
        urn="urn:test"
        title="Struttura dell'Atto"
      />,
    );

    // Not portalled, so its `md:hidden` wrapper keeps it off desktop.
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByText("Struttura dell'Atto")).toBeInTheDocument();
  });

  it('also stays open after a pick', () => {
    const onClose = vi.fn();
    const onArticleSelect = vi.fn();

    render(
      <TreeViewPanel
        variant="drawer"
        isOpen
        onClose={onClose}
        treeData={['1']}
        urn="urn:test"
        onArticleSelect={onArticleSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '1' }));

    expect(onArticleSelect).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
