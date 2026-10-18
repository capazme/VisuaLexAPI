import { useState } from 'react';
import { BookOpen, Check, FolderPlus } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { dossierService } from '../../../services/dossierService';
import { getErrorMessage } from '../../../utils/errors';
import { STUDY_PACKS, packAlreadyAdded, packContent, type StudyPack } from '../../../utils/studyPacks';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import type { EnvironmentCategory, StudyImportReport } from '../../../types';

interface Props {
  /** The Explore view's category filter: the band follows it. */
  category: EnvironmentCategory | 'all';
  onAdded: (report: StudyImportReport) => void;
  onError: (message: string) => void;
}

const SHOWN_AT_FIRST = 6;

/**
 * «Dossier di studio pronti» (spec 2026-10-13-environments-into-forum, D12): the packs VisuaLex ships, each added as
 * dossiers di studio with one request (`POST /dossiers/import-study`). A pack whose dossiers the user already holds
 * says so instead.
 */
export function StudyPacksBand({ category, onAdded, onError }: Props) {
  const dossiers = useAppStore((s) => s.dossiers);
  const [adding, setAdding] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const packs = STUDY_PACKS.filter((p) => category === 'all' || p.category === category);
  if (packs.length === 0) return null;
  const shown = showAll ? packs : packs.slice(0, SHOWN_AT_FIRST);

  const add = async (pack: StudyPack) => {
    setAdding(pack.key);
    try {
      onAdded(await dossierService.importStudy(packContent(pack), { addNotes: false, addHighlights: false }));
    } catch (err) {
      onError(getErrorMessage(err) || 'Non è stato possibile aggiungere il pacchetto. Riprova.');
    } finally {
      setAdding(null);
    }
  };

  return (
    <section aria-labelledby="study-packs" className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex items-baseline gap-2">
        <BookOpen size={16} className="self-center text-emerald-600" aria-hidden />
        <h2 id="study-packs" className="text-sm font-semibold text-slate-800 dark:text-slate-200">Dossier di studio pronti</h2>
        <span className="text-xs text-slate-500 dark:text-slate-400">di VisuaLex</span>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((pack) => {
          const added = packAlreadyAdded(pack, dossiers);
          return (
            <li key={pack.key} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 p-2 dark:border-slate-700">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-900 dark:text-white" title={pack.description}>{pack.name}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{pack.dossiers.length} dossier</span>
              </span>
              {added ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
                  <Check size={14} aria-hidden /> Già tra i tuoi dossier
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void add(pack)}
                  disabled={adding !== null}
                  aria-label={`Aggiungi «${pack.name}» ai miei dossier`}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50 dark:text-primary-300 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${TOUCH_TARGET_RESPONSIVE}`}
                >
                  <FolderPlus size={14} aria-hidden /> {adding === pack.key ? 'Aggiungo…' : 'Aggiungi'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {packs.length > SHOWN_AT_FIRST && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className={`mt-2 rounded px-2 text-sm font-medium text-primary-600 hover:underline dark:text-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${TOUCH_TARGET_RESPONSIVE}`}
        >
          {showAll ? 'Mostra meno' : `Mostra tutti (${packs.length})`}
        </button>
      )}
    </section>
  );
}
