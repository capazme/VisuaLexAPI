import { useMemo, useRef, useState } from 'react';
import { Folder, Search } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { Modal } from '../../ui/Modal';
import { dossierRecency } from '../dossier/dossierUtils';

export interface PracticeDossierPickerProps {
  isOpen: boolean;
  onPick: (dossierId: string) => void;
  onClose: () => void;
}

/**
 * «Aggiungi a un dossier…» (spec §7): the dossiers, most recent first (five, or all that match the
 * search once there are more), as `AddToDossierPopover` lists them. There is no «Nuovo dossier»
 * here: that is «Salva come dossier». Skipping what a dossier holds is the save's job, so no row is
 * disabled. A `ui/Modal`: portalled, the focus moved in (the search, else the first dossier), held
 * there by Tab, and given back to the menu's button on close.
 */
export function PracticeDossierPicker({ isOpen, onPick, onClose }: PracticeDossierPickerProps) {
  const dossiers = useAppStore((s) => s.dossiers);
  const [query, setQuery] = useState('');
  // One ref, so the Modal's focus effect never re-runs while the dialog is open: the search when
  // there is one, else the first dossier.
  const focusRef = useRef<HTMLElement | null>(null);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...dossiers]
      .filter((d) => !q || d.title.toLowerCase().includes(q))
      .sort((a, b) => dossierRecency(b) - dossierRecency(a));
  }, [dossiers, query]);
  const visible = query.trim() ? sorted : sorted.slice(0, 5);
  const withSearch = dossiers.length > 5;
  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      size="sm"
      title="Aggiungi a un dossier"
      icon={<Folder size={18} />}
      variant="info"
      initialFocusRef={focusRef}
      contentClassName="p-0"
    >
      {withSearch && (
        <div className="px-3 pt-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              ref={(node) => { focusRef.current = node; }}
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
      <div className="min-h-[80px] space-y-1 px-2 py-2">
        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm italic text-slate-500 dark:text-slate-400">
            {dossiers.length === 0 ? 'Nessun dossier presente.' : 'Nessun dossier corrisponde alla ricerca.'}
          </p>
        ) : (
          visible.map((d, index) => (
            <button
              key={d.id}
              ref={index === 0 && !withSearch ? (node) => { focusRef.current = node; } : undefined}
              type="button"
              onClick={() => {
                setQuery('');
                onPick(d.id);
              }}
              className="flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-primary-50 md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 dark:hover:bg-primary-900/10"
            >
              <Folder size={16} className="shrink-0 text-primary-500" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-200">{d.title}</span>
              <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">{d.items.length} elementi</span>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
