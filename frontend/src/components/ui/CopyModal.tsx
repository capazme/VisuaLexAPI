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
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-md mx-4 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white">
            Copia Contenuto
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          >
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Checkboxes */}
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={options.includeText}
                onChange={(e) => setOptions({ ...options, includeText: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Testo articolo</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={options.includeCitation}
                onChange={(e) => setOptions({ ...options, includeCitation: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Citazione</span>
            </label>

            <label className={cn(
              "flex items-center gap-3",
              hasNotes ? "cursor-pointer" : "opacity-50 cursor-not-allowed"
            )}>
              <input
                type="checkbox"
                checked={options.includeNotes}
                onChange={(e) => setOptions({ ...options, includeNotes: e.target.checked })}
                disabled={!hasNotes}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Note personali {!hasNotes && '(nessuna)'}
              </span>
            </label>

            <label className={cn(
              "flex items-center gap-3",
              hasHighlights ? "cursor-pointer" : "opacity-50 cursor-not-allowed"
            )}>
              <input
                type="checkbox"
                checked={options.includeHighlights}
                onChange={(e) => setOptions({ ...options, includeHighlights: e.target.checked })}
                disabled={!hasHighlights}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Evidenziazioni {!hasHighlights && '(nessuna)'}
              </span>
            </label>
          </div>

          {/* Scope */}
          {(canCopyNorma || canCopyTab) && (
            <>
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Ambito:
                </p>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="scope"
                      checked={options.scope === 'article'}
                      onChange={() => setOptions({ ...options, scope: 'article' })}
                      className="w-4 h-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Solo questo articolo</span>
                  </label>

                  {canCopyNorma && (
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="scope"
                        checked={options.scope === 'norma'}
                        onChange={() => setOptions({ ...options, scope: 'norma' })}
                        className="w-4 h-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">Tutti gli articoli della norma</span>
                    </label>
                  )}

                  {canCopyTab && (
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="scope"
                        checked={options.scope === 'tab'}
                        onChange={() => setOptions({ ...options, scope: 'tab' })}
                        className="w-4 h-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">Tutta la tab</span>
                    </label>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 rounded-b-lg">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Annulla
          </button>
          <button
            onClick={handleCopy}
            disabled={!options.includeText && !options.includeCitation && !options.includeNotes && !options.includeHighlights}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
          >
            <Copy size={16} />
            Copia
          </button>
        </div>
      </div>
    </div>
  );
}
