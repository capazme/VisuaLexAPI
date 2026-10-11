import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';

vi.mock('../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn() }) }));
vi.mock('../../../hooks/useCompare', () => ({ useCompare: () => ({ isOpen: false }) }));

import { appStore, useAppStore } from '../../../store/useAppStore';
import { WorkspaceTabPanel } from './WorkspaceTabPanel';
import { SortableWorkspaceTab } from './SortableWorkspaceTab';

const noop = () => {};

/** The panel as `WorkspaceManager` draws it: re-rendered with the tab the store holds now. */
function LivePanel({ id }: { id: string }) {
  const tab = useAppStore((s) => s.workspaceTabs.find((t) => t.id === id));
  return tab ? <WorkspaceTabPanel tab={tab} onViewPdf={noop} onCrossReference={noop} /> : null;
}

/** A dock chip wired as `WorkspaceNavigator` wires it. */
function LiveChip({ id }: { id: string }) {
  const tab = useAppStore((s) => s.workspaceTabs.find((t) => t.id === id));
  const { bringTabToFront, toggleTabVisibility, toggleTabMinimize, removeTab } = appStore.getState();
  if (!tab) return null;
  return (
    <DndContext>
      <SortableContext items={[id]}>
        <SortableWorkspaceTab
          tab={tab}
          isActive={false}
          onBringToFront={bringTabToFront}
          onToggleVisibility={toggleTabVisibility}
          onToggleMinimize={toggleTabMinimize}
          onRemove={removeTab}
        />
      </SortableContext>
    </DndContext>
  );
}

const tabOf = (id: string) => appStore.getState().workspaceTabs.find((t) => t.id === id)!;

beforeEach(() => appStore.setState({ workspaceTabs: [], pendingDecision: null }));

describe('minimising and restoring a tab, as on develop', () => {
  it('the amber button minimises an open tab and restores a minimised one', async () => {
    const user = userEvent.setup();
    const id = appStore.getState().addWorkspaceTab('Codice civile');
    render(<LivePanel id={id} />);

    await user.click(screen.getByTitle('Minimizza'));
    expect(tabOf(id).isMinimized).toBe(true);

    await user.click(screen.getByTitle('Minimizza'));
    expect(tabOf(id).isMinimized).toBe(false);
  });

  it('a press on a minimised tab\'s bar raises it and leaves it minimised', async () => {
    const user = userEvent.setup();
    const id = appStore.getState().addWorkspaceTab('Codice civile');
    appStore.getState().toggleTabMinimize(id);
    const before = tabOf(id).zIndex;
    render(<LivePanel id={id} />);

    await user.click(screen.getByText('Codice civile'));

    expect(tabOf(id).isMinimized).toBe(true);
    expect(tabOf(id).zIndex).toBeGreaterThan(before);
  });

  it('a click on a dock chip raises the tab and leaves a minimised or hidden one as it is', async () => {
    const user = userEvent.setup();
    const id = appStore.getState().addWorkspaceTab('Codice penale');
    appStore.getState().toggleTabMinimize(id);
    appStore.getState().toggleTabVisibility(id);
    const before = tabOf(id).zIndex;
    render(<LiveChip id={id} />);

    await user.click(screen.getByText('Codice penale'));

    expect(tabOf(id)).toMatchObject({ isMinimized: true, isHidden: true });
    expect(tabOf(id).zIndex).toBeGreaterThan(before);
  });
});
