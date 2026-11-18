import { useEffect } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { EmptyState } from '../../ui/EmptyState';
import { PageFrame } from '../../layout/PageFrame';
import { BackLink } from '../../ui/BackLink';
import { TrashEntryRow } from './TrashEntryRow';
import type { useTrash } from './useTrash';

interface Props {
  trash: ReturnType<typeof useTrash>;
  onBack: () => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

/**
 * «Cestino», from the dossier list (spec §10): everything a connected
 * application deleted — dossiers, entries of a dossier, study cards — and the
 * study cards the user deleted in the app, each restored whole or emptied.
 */
export function TrashPage({ trash, onBack, showToast }: Props) {
  const dossiers = useAppStore((s) => s.dossiers);
  const { entries, error, restore, purge, reload } = trash;
  // Opening the trash reads it again: Claude may have deleted since the page loaded.
  useEffect(() => { void reload(); }, [reload]);

  return (
    <div className="flex flex-col gap-4">
      <BackLink onBack={onBack} />
      {/* The section pages' frame (W2): its title is where the focus lands coming from the list (LC98, `ViewSlide`). */}
      <PageFrame
        title="Cestino"
        line="Ciò che un’applicazione collegata ha eliminato resta qui 30 giorni, come ciò che elimini tu: le pratiche, le voci che togli da una pratica, le schede di studio."
      >
        {error && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {entries && entries.length === 0 && !error && (
          <EmptyState variant="generic" title="Il cestino è vuoto" description="Nessun elemento eliminato da un’applicazione collegata, nessuna pratica, voce o scheda di studio eliminati da te." />
        )}
        {entries && entries.length > 0 && (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <TrashEntryRow
                key={entry.id}
                entry={entry}
                showSource
                dossiers={dossiers}
                onRestore={restore}
                onPurge={purge}
                showToast={showToast}
              />
            ))}
          </ul>
        )}
      </PageFrame>
    </div>
  );
}
