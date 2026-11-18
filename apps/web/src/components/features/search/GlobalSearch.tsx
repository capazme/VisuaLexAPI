import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { useSearchActions } from '../../../hooks/useSearchActions';
import { CommandPalette } from './CommandPalette';

/**
 * The palette (⌘K), mounted once by `Layout` so that it works on every page (gotcha 27: a store flag only opens a
 * modal that is mounted). What it opens lands in the practices, so from another page `useSearchActions` brings the
 * reader to the search page. The quick norms and the aliases it used to open over the page are parts of Impostazioni
 * (LC84).
 */
export function GlobalSearch() {
  const { commandPaletteOpen, closeCommandPalette } = useAppStore(useShallow((s) => ({
    commandPaletteOpen: s.commandPaletteOpen,
    closeCommandPalette: s.closeCommandPalette,
  })));
  const actions = useSearchActions();
  const navigate = useNavigate();

  return (
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={closeCommandPalette}
        onSearch={actions.search}
        onBrowseStructure={(params) => void actions.browse(params)}
        onShowSearch={actions.goToSearch}
        onOpenRassegne={(passo) => navigate('/rassegne', passo ? { state: { passo } } : undefined)}
      />
  );
}
