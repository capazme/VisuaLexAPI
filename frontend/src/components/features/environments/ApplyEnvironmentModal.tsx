import { X, Plus, RefreshCw } from 'lucide-react';
import type { Environment } from '../../../types';

interface ApplyEnvironmentModalProps {
  environment: Environment;
  onClose: () => void;
  onApply: (env: Environment, mode: 'replace' | 'merge') => void;
}

export function ApplyEnvironmentModal({
  environment,
  onClose,
  onApply,
}: ApplyEnvironmentModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Applica "{environment.name}"
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            Come vuoi applicare questo ambiente?
          </p>

          <button
            onClick={() => onApply(environment, 'merge')}
            className="w-full p-4 text-left bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                <Plus className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <span className="font-medium text-slate-900 dark:text-white">Unisci</span>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Aggiunge al contenuto esistente, salta duplicati
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => onApply(environment, 'replace')}
            className="w-full p-4 text-left bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center">
                <RefreshCw className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <span className="font-medium text-slate-900 dark:text-white">Sostituisci</span>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Sostituisce tutto il contenuto attuale
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
