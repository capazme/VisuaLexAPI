import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Button } from '../../ui/Button';
import type { TrashEntry } from '../../../services/trashService';
import type { Dossier } from '../../../types';
import { TrashEntryRow } from './TrashEntryRow';
import type { RestoreOutcome } from './useTrash';

interface Props {
  /** This dossier's entries in the trash (kind DOSSIER_ITEMS). */
  entries: TrashEntry[];
  dossiers: Dossier[];
  onRestore: (entry: TrashEntry, targetDossierId?: string) => Promise<RestoreOutcome>;
  onPurge: (entry: TrashEntry) => Promise<boolean>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

/**
 * «Rimossi di recente (n)» at the bottom of a dossier (spec §11): what a
 * connected application removed from it, and what you removed yourself, each entry restored whole. Not drawn
 * when there is nothing.
 */
export function DossierRecentlyRemoved({ entries, dossiers, onRestore, onPurge, showToast }: Props) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  const regionId = 'dossier-recently-removed';
  return (
    <section aria-labelledby="dossier-recently-removed-heading" className="mt-6 border-t border-slate-200 pt-3 dark:border-slate-700">
      <h2 id="dossier-recently-removed-heading">
        <Button
          type="button"
          variant="quiet"
          // 44 px at every width, as the planner's controls (S7c); the words at the column's edge.
          size="lg"
          aria-expanded={open}
          aria-controls={open ? regionId : undefined}
          onClick={() => setOpen((v) => !v)}
          className="-ml-2 px-2 text-sm/5"
          icon={<ChevronDown size={16} aria-hidden className={cn('transition-transform motion-reduce:transition-none', !open && '-rotate-90')} />}
        >
          Rimossi di recente ({entries.length}): ripristina
        </Button>
      </h2>
      {open && (
        <ul id={regionId} className="mt-2 space-y-2">
          {entries.map((entry) => (
            <TrashEntryRow
              key={entry.id}
              entry={entry}
              showSource={false}
              dossiers={dossiers}
              onRestore={onRestore}
              onPurge={onPurge}
              showToast={showToast}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
