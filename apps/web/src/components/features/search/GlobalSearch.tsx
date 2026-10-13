import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { useSearchActions } from '../../../hooks/useSearchActions';
import { CommandPalette } from './CommandPalette';
import { QuickNormsManager } from './QuickNormsManager';
import { AliasManager } from '../settings/AliasManager';

/**
 * The palette (⌘K) and the two managers it opens, mounted once by `Layout` so that they work on every
 * page (gotcha 27: a store flag only opens a modal that is mounted). What they open lands in the
 * practices, so from another page `useSearchActions` brings the reader to the search page.
 */
export function GlobalSearch() {
  const { commandPaletteOpen, closeCommandPalette, quickNormsManagerOpen, closeQuickNormsManager } = useAppStore(useShallow((s) => ({
    commandPaletteOpen: s.commandPaletteOpen,
    closeCommandPalette: s.closeCommandPalette,
    quickNormsManagerOpen: s.quickNormsManagerOpen,
    closeQuickNormsManager: s.closeQuickNormsManager,
  })));
  const actions = useSearchActions();

  return (
    <>
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={closeCommandPalette}
        onSearch={actions.search}
        onBrowseStructure={(params) => void actions.browse(params)}
        onShowSearch={actions.goToSearch}
      />
      <QuickNormsManager isOpen={quickNormsManagerOpen} onClose={closeQuickNormsManager} onSearch={actions.search} />
      <AliasManager />
    </>
  );
}
