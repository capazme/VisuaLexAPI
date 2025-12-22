import { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { cn } from '../../lib/utils';

interface CopyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCopy: (options: CopyOptions) => void;
  hasNotes: boolean;
  hasHighlights: boolean;
  canCopyTab?: boolean;
  canCopyNorma?: boolean;
}

export interface CopyOptions {
  includeText: boolean;
  includeCitation: boolean;
  includeNotes: boolean;
  includeHighlights: boolean;
  scope: 'article' | 'norma' | 'tab';
}

export function CopyModal({
  isOpen,
  onClose,
  onCopy,
  hasNotes,
  hasHighlights,
  canCopyTab = false,
  canCopyNorma = false
}: CopyModalProps) {
  const [options, setOptions] = useState<CopyOptions>({
    includeText: true,
    includeCitation: true,
    includeNotes: false,
    includeHighlights: false,
    scope: 'article'
  });

  if (!isOpen) return null;

  const handleCopy = () => {
    onCopy(options);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 w-full max-w-md mx-4 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="font-semibold text-slate-900 dark:text-white">
            Copia Contenuto
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
          >
            <X size={18} className="text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Content Section - Custom Checkboxes */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase mb-3">Contenuto</p>
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-1 space-y-1">
              <label className={cn(
                "flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-white dark:hover:bg-slate-800"
              )}>
                <div className="relative flex items-center justify-center mt-0.5">
                  <input
                    type="checkbox"
                    checked={options.includeText}
                    onChange={(e) => setOptions({ ...options, includeText: e.target.checked })}
                    className="sr-only"
                  />
                  <div className={cn(
                    "w-5 h-5 rounded border-2 flex items-center justify-center transition-all",
                    options.includeText
                      ? "bg-blue-600 border-blue-600"
                      : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600"
                  )}>
                    {options.includeText && <Check size={14} className="text-white" />}
                  </div>
                </div>
                <div className="flex-1">
                  <span className="font-medium text-slate-900 dark:text-white text-sm">Testo articolo</span>
                  <p className="text-xs text-slate-500 mt-0.5">Include il testo completo dell'articolo</p>
                </div>
              </label>

              <label className={cn(
                "flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-white dark:hover:bg-slate-800"
              )}>
                <div className="relative flex items-center justify-center mt-0.5">
                  <input
                    type="checkbox"
                    checked={options.includeCitation}
                    onChange={(e) => setOptions({ ...options, includeCitation: e.target.checked })}
                    className="sr-only"
                  />
                  <div className={cn(
                    "w-5 h-5 rounded border-2 flex items-center justify-center transition-all",
                    options.includeCitation
                      ? "bg-blue-600 border-blue-600"
                      : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600"
                  )}>
                    {options.includeCitation && <Check size={14} className="text-white" />}
                  </div>
                </div>
                <div className="flex-1">
                  <span className="font-medium text-slate-900 dark:text-white text-sm">Citazione</span>
                  <p className="text-xs text-slate-500 mt-0.5">Riferimento normativo formale</p>
                </div>
              </label>

              <label className={cn(
                "flex items-start gap-3 p-3 rounded-lg transition-colors",
                hasNotes ? "cursor-pointer hover:bg-white dark:hover:bg-slate-800" : "opacity-50 cursor-not-allowed"
              )}>
                <div className="relative flex items-center justify-center mt-0.5">
                  <input
                    type="checkbox"
                    checked={options.includeNotes}
                    onChange={(e) => setOptions({ ...options, includeNotes: e.target.checked })}
                    disabled={!hasNotes}
                    className="sr-only"
                  />
                  <div className={cn(
                    "w-5 h-5 rounded border-2 flex items-center justify-center transition-all",
                    options.includeNotes
                      ? "bg-blue-600 border-blue-600"
                      : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600"
                  )}>
                    {options.includeNotes && <Check size={14} className="text-white" />}
                  </div>
                </div>
                <div className="flex-1">
                  <span className="font-medium text-slate-900 dark:text-white text-sm">
                    Note personali {!hasNotes && <span className="text-slate-400">(nessuna)</span>}
                  </span>
                  <p className="text-xs text-slate-500 mt-0.5">Include le tue annotazioni</p>
                </div>
              </label>

              <label className={cn(
                "flex items-start gap-3 p-3 rounded-lg transition-colors",
                hasHighlights ? "cursor-pointer hover:bg-white dark:hover:bg-slate-800" : "opacity-50 cursor-not-allowed"
              )}>
                <div className="relative flex items-center justify-center mt-0.5">
                  <input
                    type="checkbox"
                    checked={options.includeHighlights}
                    onChange={(e) => setOptions({ ...options, includeHighlights: e.target.checked })}
                    disabled={!hasHighlights}
                    className="sr-only"
                  />
                  <div className={cn(
                    "w-5 h-5 rounded border-2 flex items-center justify-center transition-all",
                    options.includeHighlights
                      ? "bg-blue-600 border-blue-600"
                      : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600"
                  )}>
                    {options.includeHighlights && <Check size={14} className="text-white" />}
                  </div>
                </div>
                <div className="flex-1">
                  <span className="font-medium text-slate-900 dark:text-white text-sm">
                    Evidenziazioni {!hasHighlights && <span className="text-slate-400">(nessuna)</span>}
                  </span>
                  <p className="text-xs text-slate-500 mt-0.5">Include le parti evidenziate</p>
                </div>
              </label>
            </div>
          </div>

          {/* Scope Section */}
          {(canCopyNorma || canCopyTab) && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase mb-3">Ambito</p>
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-1 space-y-1">
                <label className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-white dark:hover:bg-blue-900/30">
                  <input
                    type="radio"
                    name="scope"
                    checked={options.scope === 'article'}
                    onChange={() => setOptions({ ...options, scope: 'article' })}
                    className="sr-only"
                  />
                  <div className={cn(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                    options.scope === 'article'
                      ? "border-blue-600 dark:border-blue-400"
                      : "border-slate-300 dark:border-slate-600"
                  )}>
                    {options.scope === 'article' && <div className="w-2.5 h-2.5 bg-blue-600 dark:bg-blue-400 rounded-full" />}
                  </div>
                  <span className="text-sm font-medium text-slate-900 dark:text-white">Solo questo articolo</span>
                </label>

                {canCopyNorma && (
                  <label className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-white dark:hover:bg-blue-900/30">
                    <input
                      type="radio"
                      name="scope"
                      checked={options.scope === 'norma'}
                      onChange={() => setOptions({ ...options, scope: 'norma' })}
                      className="sr-only"
                    />
                    <div className={cn(
                      "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                      options.scope === 'norma'
                        ? "border-blue-600 dark:border-blue-400"
                        : "border-slate-300 dark:border-slate-600"
                    )}>
                      {options.scope === 'norma' && <div className="w-2.5 h-2.5 bg-blue-600 dark:bg-blue-400 rounded-full" />}
                    </div>
                    <span className="text-sm font-medium text-slate-900 dark:text-white">Tutti gli articoli della norma</span>
                  </label>
                )}

                {canCopyTab && (
                  <label className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-white dark:hover:bg-blue-900/30">
                    <input
                      type="radio"
                      name="scope"
                      checked={options.scope === 'tab'}
                      onChange={() => setOptions({ ...options, scope: 'tab' })}
                      className="sr-only"
                    />
                    <div className={cn(
                      "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                      options.scope === 'tab'
                        ? "border-blue-600 dark:border-blue-400"
                        : "border-slate-300 dark:border-slate-600"
                    )}>
                      {options.scope === 'tab' && <div className="w-2.5 h-2.5 bg-blue-600 dark:bg-blue-400 rounded-full" />}
                    </div>
                    <span className="text-sm font-medium text-slate-900 dark:text-white">Tutta la tab</span>
                  </label>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 rounded-b-lg">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            Annulla
          </button>
          <button
            onClick={handleCopy}
            disabled={!options.includeText && !options.includeCitation && !options.includeNotes && !options.includeHighlights}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
          >
            <Copy size={16} />
            Copia
          </button>
        </div>
      </div>
    </div>
  );
}
