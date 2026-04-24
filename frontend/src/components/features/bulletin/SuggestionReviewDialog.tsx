import { useMemo, useState } from 'react';
import { X, Check, X as XIcon, FileText, Highlighter, Folder, Zap, Link2, ChevronDown, ChevronRight } from 'lucide-react';
import type { EnvironmentSuggestion, SuggestionItem, SuggestionItemType } from '../../../types';
import { SuggestionItemCard } from './SuggestionItemCard';

export type TakeResult =
  | { kind: 'ok' }
  | { kind: 'alias_conflict'; itemId: string; suggestedTrigger: string; existingAliasId?: string };

interface SuggestionReviewDialogProps {
  suggestion: EnvironmentSuggestion;
  onTake: (itemId: string) => Promise<TakeResult>;
  onDecline: (itemId: string, reviewNote?: string) => Promise<void>;
  onClose: () => void;
}

const SECTION_ORDER: SuggestionItemType[] = ['annotation', 'highlight', 'dossier', 'quickNorm', 'alias'];
const SECTION_META: Record<SuggestionItemType, { label: string; Icon: typeof FileText }> = {
  annotation: { label: 'Note', Icon: FileText },
  highlight: { label: 'Evidenze', Icon: Highlighter },
  dossier: { label: 'Dossier', Icon: Folder },
  quickNorm: { label: 'Norme veloci', Icon: Zap },
  alias: { label: 'Alias', Icon: Link2 },
};

export function SuggestionReviewDialog({ suggestion, onTake, onDecline, onClose }: SuggestionReviewDialogProps) {
  const [declineTargetId, setDeclineTargetId] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState('');
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<SuggestionItemType, boolean>>({
    annotation: true, highlight: false, dossier: false, quickNorm: false, alias: false,
  });

  const grouped = useMemo(() => {
    const acc: Record<SuggestionItemType, SuggestionItem[]> = {
      annotation: [], highlight: [], dossier: [], quickNorm: [], alias: [],
    };
    for (const i of suggestion.items) acc[i.itemType].push(i);
    return acc;
  }, [suggestion.items]);

  const reviewedCount = suggestion.counts.taken + suggestion.counts.declined;
  const totalCount = suggestion.items.length;

  const handleTake = async (itemId: string) => {
    setBusyItemId(itemId);
    try {
      await onTake(itemId);
    } finally {
      setBusyItemId(null);
    }
  };

  const handleConfirmDecline = async () => {
    if (!declineTargetId) return;
    setBusyItemId(declineTargetId);
    try {
      await onDecline(declineTargetId, declineNote.trim() || undefined);
      setDeclineTargetId(null);
      setDeclineNote('');
    } finally {
      setBusyItemId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Suggerimento da @{suggestion.suggester.username}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              per "{suggestion.sharedEnvironment?.title}" · {new Date(suggestion.createdAt).toLocaleDateString('it-IT')}
            </p>
            {suggestion.message && (
              <p className="mt-2 text-sm italic text-slate-700 dark:text-slate-300 max-w-prose">
                "{suggestion.message}"
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body: grouped items */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {SECTION_ORDER.map((type) => {
            const items = grouped[type];
            if (items.length === 0) return null;
            const { label, Icon } = SECTION_META[type];
            const isOpen = expanded[type];
            return (
              <div key={type}>
                <button
                  type="button"
                  onClick={() => setExpanded(prev => ({ ...prev, [type]: !prev[type] }))}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? 'Comprimi' : 'Espandi'} ${label}`}
                  className="w-full flex items-center gap-2 px-1 py-1 text-left text-sm font-medium text-slate-700 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
                >
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <Icon size={16} />
                  {label} ({items.length})
                </button>
                {isOpen && (
                  <div className="mt-2 space-y-2">
                    {items.map(item => (
                      <SuggestionItemCard
                        key={item.id}
                        item={item}
                        actions={
                          <>
                            <button
                              onClick={() => handleTake(item.id)}
                              disabled={busyItemId === item.id}
                              title="Prendi"
                              className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50 disabled:opacity-50"
                            >
                              <Check size={16} />
                            </button>
                            <button
                              onClick={() => setDeclineTargetId(item.id)}
                              disabled={busyItemId === item.id}
                              title="Rifiuta"
                              className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50"
                            >
                              <XIcon size={16} />
                            </button>
                          </>
                        }
                        footer={item.status === 'declined' && item.reviewNote ? (
                          <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">
                            Nota: "{item.reviewNote}"
                          </p>
                        ) : null}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer: progress + close */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <span className="text-sm text-slate-600 dark:text-slate-400">
            {reviewedCount}/{totalCount} revisionati
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            Chiudi
          </button>
        </div>

        {/* Decline popover (inline modal) */}
        {declineTargetId && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-4 bg-black/40">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md p-5">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-2">Rifiuta questo item</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                Puoi opzionalmente aggiungere una nota per il suggeritore (max 500 caratteri).
              </p>
              <textarea
                value={declineNote}
                onChange={(e) => setDeclineNote(e.target.value.slice(0, 500))}
                rows={3}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white resize-none"
              />
              <div className="text-xs text-slate-500 text-right">{declineNote.length}/500</div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => { setDeclineTargetId(null); setDeclineNote(''); }}
                  className="px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-800 rounded hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  Annulla
                </button>
                <button
                  onClick={handleConfirmDecline}
                  disabled={busyItemId === declineTargetId}
                  className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                >
                  Conferma rifiuto
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
