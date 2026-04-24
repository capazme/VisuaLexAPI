import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface AliasConflictDialogProps {
  suggestedTrigger: string;
  onChoose: (choice: { action: 'replace' } | { action: 'rename'; newTrigger: string } | { action: 'skip' }) => void;
  onClose: () => void;
}

export function AliasConflictDialog({ suggestedTrigger, onChoose, onClose }: AliasConflictDialogProps) {
  const [renameValue, setRenameValue] = useState(`${suggestedTrigger}-2`);
  const trimmed = renameValue.trim();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md p-5">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className="text-amber-500 shrink-0" size={20} />
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Trigger già in uso
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Hai già un alias con trigger <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">{suggestedTrigger}</code>. Come vuoi procedere?
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => onChoose({ action: 'replace' })}
            className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <div className="text-sm font-medium text-slate-900 dark:text-white">Sostituisci il mio alias</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Il tuo alias esistente verrà eliminato.</div>
          </button>

          <div className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="text-sm font-medium text-slate-900 dark:text-white mb-1">Rinomina prima di importare</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="flex-1 px-2 py-1 text-sm rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
              <button
                onClick={() => onChoose({ action: 'rename', newTrigger: trimmed })}
                disabled={!trimmed || trimmed === suggestedTrigger}
                className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Usa
              </button>
            </div>
          </div>

          <button
            onClick={() => onChoose({ action: 'skip' })}
            className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <div className="text-sm font-medium text-slate-900 dark:text-white">Salta questo elemento</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">L'item resta pending, puoi decidere più tardi.</div>
          </button>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
            Annulla
          </button>
        </div>
      </div>
    </div>
  );
}
