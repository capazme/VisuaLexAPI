import { useState } from 'react';
import { Check, FolderPlus } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { dossierService } from '../../../services/dossierService';
import { getErrorMessage } from '../../../utils/errors';
import { STUDY_PACKS, packAlreadyAdded, packContent, type StudyPack } from '../../../utils/studyPacks';
import { cn } from '../../../lib/utils';
import type { EnvironmentCategory, StudyImportReport } from '../../../types';

interface Props {
  /** The Explore view's category filter: the band follows it. */
  category: EnvironmentCategory | 'all';
  onAdded: (report: StudyImportReport) => void;
  onError: (message: string) => void;
}

/** The pack's 44 px controls (S7a): on every width, the strip being a row of small cards. */
const ACTION = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium';

/**
 * «Pronti da VisuaLex» (spec 2026-10-13-environments-into-forum, D12; S7a): the packs VisuaLex ships, as one row of
 * compact cards that scrolls sideways, after the community's dossiers — they are the Forum's reason, the packs a help.
 * Each is added as dossiers di studio with one request (`POST /dossiers/import-study`); a pack whose dossiers the user
 * already holds says so instead. Every pack is in the row: a swipe, the trackpad or Tab reach them.
 */
export function StudyPacksBand({ category, onAdded, onError }: Props) {
  const dossiers = useAppStore((s) => s.dossiers);
  const [adding, setAdding] = useState<string | null>(null);
  // Added in this visit: marked at once, before the dossier list is read again, so a second tap makes no second copy.
  const [addedNow, setAddedNow] = useState<ReadonlySet<string>>(new Set());
  const packs = STUDY_PACKS.filter((p) => category === 'all' || p.category === category);
  if (packs.length === 0) return null;

  const add = async (pack: StudyPack) => {
    setAdding(pack.key);
    try {
      const report = await dossierService.importStudy(packContent(pack), { addNotes: false, addHighlights: false });
      setAddedNow((prev) => new Set(prev).add(pack.key));
      onAdded(report);
    } catch (err) {
      onError(getErrorMessage(err) || 'Non è stato possibile aggiungere il pacchetto. Riprova.');
    } finally {
      setAdding(null);
    }
  };

  return (
    <section aria-labelledby="study-packs" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 id="study-packs" className="font-serif text-xl font-medium tracking-tight text-slate-900 dark:text-slate-50">
          Pronti da VisuaLex
        </h2>
        <span className="text-sm text-slate-600 dark:text-slate-400">dossier di studio da aggiungere ai tuoi</span>
      </div>
      {/* One row that scrolls sideways, each card snapping to the start; the cards keep one width and one height. */}
      <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-3 pt-1">
        {packs.map((pack) => {
          const added = addedNow.has(pack.key) || packAlreadyAdded(pack, dossiers);
          return (
            <li
              key={pack.key}
              className="flex w-56 shrink-0 snap-start flex-col justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
            >
              <span className="min-w-0">
                <span className="line-clamp-2 break-words font-serif text-base font-medium leading-snug text-slate-900 dark:text-slate-50" title={pack.description}>
                  {pack.name}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
                  <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `hsl(var(--category-${pack.category}))` }} />
                  {pack.dossiers.length} dossier
                </span>
              </span>
              {added ? (
                <span className={cn(ACTION, 'px-0 text-emerald-700 dark:text-emerald-300')}>
                  <Check size={16} aria-hidden /> Già tra i tuoi dossier
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void add(pack)}
                  disabled={adding !== null}
                  aria-label={`Aggiungi «${pack.name}» ai miei dossier`}
                  className={cn(
                    ACTION,
                    '-mx-2 self-start text-primary-700 hover:bg-primary-50 disabled:opacity-50 dark:text-primary-300 dark:hover:bg-primary-900/30',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                  )}
                >
                  <FolderPlus size={16} aria-hidden /> {adding === pack.key ? 'Aggiungo…' : 'Aggiungi'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
