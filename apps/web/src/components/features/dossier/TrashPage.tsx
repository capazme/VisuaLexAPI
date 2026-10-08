import { useEffect } from 'react';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { EmptyState } from '../../ui/EmptyState';
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
    <div>
      <button
        onClick={onBack}
        className="mb-4 inline-flex min-h-[44px] items-center gap-2 rounded text-sm text-slate-500 hover:text-blue-600 md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <ArrowLeft size={16} /> Torna ai Dossier
      </button>
      <header className="mb-4 border-b border-slate-200 pb-4 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900 md:text-2xl dark:text-white">
          <Trash2 className="text-slate-500" size={22} aria-hidden /> Cestino
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Ciò che un’applicazione collegata ha eliminato resta qui 30 giorni, come le schede di studio che elimini tu. Il resto di ciò che elimini nell’app si può annullare subito e non passa di qui.
        </p>
      </header>
      {error && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {entries && entries.length === 0 && !error && (
        <EmptyState variant="generic" title="Il cestino è vuoto" description="Nessun elemento eliminato da un’applicazione collegata, nessuna scheda di studio eliminata da te." />
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
    </div>
  );
}
