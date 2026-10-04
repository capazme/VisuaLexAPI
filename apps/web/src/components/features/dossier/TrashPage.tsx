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
 * application deleted — dossiers, entries of a dossier, LingoLex cards (only
 * here, until LingoLex has screens) — each restored whole or emptied.
 */
export function TrashPage({ trash, onBack, showToast }: Props) {
  const dossiers = useAppStore((s) => s.dossiers);
  const { entries, error, restore, purge } = trash;

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
          Ciò che un’applicazione collegata ha eliminato resta qui 30 giorni. Ciò che elimini tu dall’app si annulla subito, non passa di qui.
        </p>
      </header>
      {error && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {entries && entries.length === 0 && !error && (
        <EmptyState variant="generic" title="Il cestino è vuoto" description="Nessun elemento eliminato da un’applicazione collegata." />
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
