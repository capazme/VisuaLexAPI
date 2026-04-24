import { BookOpen, Layers, X } from 'lucide-react';
import { formatDateItalianLong } from '../../../utils/dateUtils';
import type { NormaGroup } from './dossierUtils';

interface Props {
  groups: NormaGroup[];
  onPick: (group: NormaGroup) => void;
  onPickAll: () => void;
  onClose: () => void;
}

// Shown when a dossier spans multiple norms: the backend pipeline is
// single-norma per search call, so we surface the norms as a picker. The first
// row is a "open them all" shortcut that queues every group into one single
// workspace tab (shared tabLabel → merged via addNormaToTab upstream).
export function OpenOnDashboardPicker({ groups, onPick, onPickAll, onClose }: Props) {
  const totalArticles = groups.reduce((sum, g) => sum + g.articles.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="font-semibold text-lg text-slate-900 dark:text-white">Quale norma aprire?</h3>
          <button
            onClick={onClose}
            aria-label="Chiudi"
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            Il dossier contiene articoli da {groups.length} norme diverse. Scegli quale aprire, o apri tutto in un'unica tab.
          </p>

          <button
            type="button"
            onClick={onPickAll}
            className="w-full text-left px-4 py-3 rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 flex items-start gap-3"
          >
            <Layers size={18} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm text-slate-900 dark:text-white">
                Apri tutte le norme in una sola tab
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                {groups.length} norme, {totalArticles} articoli totali
              </div>
            </div>
          </button>

          <div className="flex items-center gap-2 my-3">
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
            <span className="text-xs text-slate-400 dark:text-slate-500">oppure solo una</span>
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
          </div>

          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => onPick(g)}
              className="w-full text-left px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 flex items-start gap-3"
            >
              <BookOpen size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-slate-900 dark:text-white truncate">
                  {g.tipo_atto}
                  {g.numero_atto ? ` ${g.numero_atto}` : ''}
                  {g.data ? ` — ${formatDateItalianLong(g.data)}` : ''}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {g.articles.length} articoli: {g.articles.slice(0, 6).join(', ')}
                  {g.articles.length > 6 ? `, +${g.articles.length - 6} altri` : ''}
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="flex justify-end px-6 py-3 border-t border-slate-200 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Annulla
          </button>
        </div>
      </div>
    </div>
  );
}
