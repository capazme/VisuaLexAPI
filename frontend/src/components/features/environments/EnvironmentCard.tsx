import { useState } from 'react';
import {
  Download, Link2, Trash2, Plus, RefreshCw, FolderOpen, Star,
  FileText, Pencil, MoreHorizontal, Replace,
} from 'lucide-react';
import type { Environment } from '../../../types';
import {
  ENVIRONMENT_CATEGORIES,
  getCategoryBgAlpha,
  getEnvironmentStats,
  canShareAsLink,
} from '../../../utils/environmentUtils';

interface EnvironmentCardProps {
  environment: Environment;
  isFirst?: boolean;
  onApplyMerge: () => void;
  onApplyReplace: () => void;
  onViewDetail: () => void;
  onEdit: () => void;
  onExportJSON: () => void;
  onShareLink: () => void;
  onRefresh: () => void;
  onDelete: () => void;
}

export function EnvironmentCard({
  environment,
  isFirst,
  onApplyMerge,
  onApplyReplace,
  onViewDetail,
  onEdit,
  onExportJSON,
  onShareLink,
  onRefresh,
  onDelete,
}: EnvironmentCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const stats = getEnvironmentStats(environment);
  const category = environment.category ? ENVIRONMENT_CATEGORIES[environment.category] : null;
  const canShare = canShareAsLink(environment);

  return (
    <div
      id={isFirst ? 'tour-env-card' : undefined}
      className="dossier-card group relative bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm hover:border-blue-300 dark:hover:border-blue-700 transition-colors overflow-hidden cursor-pointer"
      onClick={onViewDetail}
    >
      {/* Category Stripe (4px leading edge) — see dossier polish round 3 */}
      {category && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
          style={{ backgroundColor: category.color }}
        />
      )}

      <div className="p-4 pl-5 md:p-4 md:pl-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
            <div
              className="w-10 h-10 md:w-10 md:h-10 flex-shrink-0 rounded-lg flex items-center justify-center text-base md:text-lg"
              style={{ backgroundColor: getCategoryBgAlpha(environment.category, 0.08) }}
            >
              {category?.icon || '📁'}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-sm md:text-base text-slate-900 dark:text-white line-clamp-1">
                {environment.name}
              </h3>
              {category && (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {category.label}
                </span>
              )}
            </div>
          </div>

          {/* Menu */}
          <div className="relative flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
              className="p-2 md:p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md md:opacity-0 md:group-hover:opacity-100 transition-opacity min-h-[44px] md:min-h-0 flex items-center justify-center"
              aria-label="Menu azioni"
            >
              <MoreHorizontal size={18} className="text-slate-500" />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-1 w-56 md:w-48 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 py-1 z-20">
                  <button
                    onClick={() => { onEdit(); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-3 md:py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-left"
                  >
                    <Pencil size={16} /> Modifica
                  </button>
                  <button
                    onClick={() => { onExportJSON(); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-3 md:py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-left"
                  >
                    <Download size={16} /> Esporta JSON
                  </button>
                  {canShare && (
                    <button
                      onClick={() => { onShareLink(); setShowMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-3 md:py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-left"
                    >
                      <Link2 size={16} /> Copia Link
                    </button>
                  )}
                  <button
                    onClick={() => { onRefresh(); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-3 md:py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-left"
                  >
                    <RefreshCw size={16} /> Aggiorna da stato corrente
                  </button>
                  <div className="border-t border-slate-200 dark:border-slate-700 my-1" />
                  <button
                    onClick={() => { onApplyReplace(); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-3 md:py-2 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-left"
                  >
                    <Replace size={16} /> Sostituisci tutto&hellip;
                  </button>
                  <button
                    onClick={() => { onDelete(); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-3 md:py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 text-left"
                  >
                    <Trash2 size={16} /> Elimina
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Description */}
        {environment.description && (
          <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mb-3 line-clamp-2">
            {environment.description}
          </p>
        )}

        {/* Stats */}
        <div className="flex flex-wrap gap-2 md:gap-3 mb-4 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <FolderOpen size={14} /> {stats.dossiers} dossier
          </span>
          <span className="flex items-center gap-1">
            <Star size={14} /> {stats.quickNorms} preferiti
          </span>
          {stats.annotations > 0 && (
            <span className="flex items-center gap-1">
              <FileText size={14} /> {stats.annotations} note
            </span>
          )}
        </div>

        {/* Merge primary — happy path for "apply". Replace lives in the
            3-dot menu because it's destructive (ConfirmDialog-guarded in
            the parent). */}
        <button
          id={isFirst ? 'tour-env-apply' : undefined}
          onClick={(e) => { e.stopPropagation(); onApplyMerge(); }}
          className="w-full flex items-center justify-center gap-2 py-2.5 md:py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium min-h-[44px]"
          title="Unisci al contenuto esistente (salta duplicati)"
        >
          <Plus size={16} />
          Unisci
        </button>
      </div>
    </div>
  );
}
