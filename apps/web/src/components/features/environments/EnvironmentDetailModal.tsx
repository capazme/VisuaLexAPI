import {
  X, Trash2, Pencil, Download, Link2, Play,
} from 'lucide-react';
import type { Environment } from '../../../types';
import {
  ENVIRONMENT_CATEGORIES,
  getCategoryBgAlpha,
  canShareAsLink,
} from '../../../utils/environmentUtils';
import { EnvironmentContentViewer } from './EnvironmentContentViewer';

interface EnvironmentDetailModalProps {
  environment: Environment;
  onClose: () => void;
  onApply: () => void;
  onEdit: () => void;
  onExportJSON: () => void;
  onShareLink: () => void;
  onDelete: () => void;
}

export function EnvironmentDetailModal({
  environment,
  onClose,
  onApply,
  onEdit,
  onExportJSON,
  onShareLink,
  onDelete,
}: EnvironmentDetailModalProps) {
  const category = environment.category ? ENVIRONMENT_CATEGORIES[environment.category] : null;
  const canShare = canShareAsLink(environment);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div
              className="w-12 h-12 flex-shrink-0 rounded-lg flex items-center justify-center text-xl"
              style={{ backgroundColor: getCategoryBgAlpha(environment.category, 0.08) }}
            >
              {category?.icon || '📁'}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white line-clamp-1">
                {environment.name}
              </h2>
              <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                {category && <span>{category.label}</span>}
                {environment.author && <span>• {environment.author}</span>}
                {environment.version && <span>• v{environment.version}</span>}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-2 -mr-2 min-h-[44px] flex items-center justify-center flex-shrink-0"
            aria-label="Chiudi"
          >
            <X size={20} />
          </button>
        </div>

        {/* Description */}
        {environment.description && (
          <div className="px-4 md:px-6 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {environment.description}
            </p>
          </div>
        )}

        {/* Content Viewer */}
        <div className="p-4 md:p-6 overflow-y-auto flex-1">
          <EnvironmentContentViewer
            environment={environment}
            maxHeight="350px"
          />
        </div>

        {/* Actions */}
        <div className="px-4 md:px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div className="flex flex-wrap gap-2 justify-between">
            <div className="flex gap-2">
              <button
                onClick={() => { onDelete(); onClose(); }}
                className="px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Trash2 size={16} />
                <span className="hidden sm:inline">Elimina</span>
              </button>
              <button
                onClick={() => { onEdit(); onClose(); }}
                className="px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Pencil size={16} />
                <span className="hidden sm:inline">Modifica</span>
              </button>
              <button
                onClick={onExportJSON}
                className="px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Download size={16} />
                <span className="hidden sm:inline">Esporta</span>
              </button>
              {canShare && (
                <button
                  onClick={onShareLink}
                  className="px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <Link2 size={16} />
                  <span className="hidden sm:inline">Link</span>
                </button>
              )}
            </div>
            <button
              onClick={() => { onApply(); onClose(); }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
            >
              <Play size={16} />
              Applica
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
