import { useEffect, useMemo, useState } from 'react';
import { FloatingPortal } from '@floating-ui/react';
import { Folder, Search, X } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import { dossierRecency } from '../dossier/dossierUtils';

export interface PracticeDossierPickerProps {
  onPick: (dossierId: string) => void;
  onClose: () => void;
}

/**
 * «Aggiungi a un dossier…» (spec §7): the dossiers, most recent first (five, or all that match the
 * search once there are more), as `AddToDossierPopover` lists them. There is no «Nuovo dossier»
 * here: that is «Salva come dossier». Skipping what a dossier holds is the save's job, so no row is
 * disabled.
 */
export function PracticeDossierPicker({ onPick, onClose }: PracticeDossierPickerProps) {
  const dossiers = useAppStore((s) => s.dossiers);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...dossiers]
      .filter((d) => !q || d.title.toLowerCase().includes(q))
      .sort((a, b) => dossierRecency(b) - dossierRecency(a));
  }, [dossiers, query]);
  const visible = query.trim() ? sorted : sorted.slice(0, 5);

  return (
    <FloatingPortal>
      <div className={cn('fixed inset-0 bg-black/30', Z_INDEX.citationPreview)} onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Aggiungi a un dossier"
        className={cn(
          'fixed inset-x-4 bottom-4 flex max-h-[70vh] flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl',
          'dark:border-slate-800 dark:bg-slate-900 md:inset-x-auto md:left-1/2 md:top-1/3 md:bottom-auto md:w-80 md:-translate-x-1/2',
          Z_INDEX.citationPreview,
        )}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-2">
            <Folder size={16} className="shrink-0 text-primary-500" aria-hidden />
            <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">Aggiungi a un dossier</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X size={16} />
          </button>
        </header>
        {dossiers.length > 5 && (
          <div className="shrink-0 px-3 pt-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cerca dossier…"
                aria-label="Cerca dossier"
                className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>
        )}
        <div className="min-h-[80px] flex-1 space-y-1 overflow-y-auto px-2 py-2">
          {visible.length === 0 ? (
            <p className="py-6 text-center text-sm italic text-slate-500 dark:text-slate-400">
              {dossiers.length === 0 ? 'Nessun dossier presente.' : 'Nessun dossier corrisponde alla ricerca.'}
            </p>
          ) : (
            visible.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onPick(d.id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 dark:hover:bg-primary-900/10"
              >
                <Folder size={16} className="shrink-0 text-primary-500" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-200">{d.title}</span>
                <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">{d.items.length} elementi</span>
              </button>
            ))
          )}
        </div>
      </div>
    </FloatingPortal>
  );
}
