import { useMemo, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { EnvironmentSuggestion, SuggestionItem, SuggestionItemType } from '../../../types';
import { SuggestionItemCard } from './SuggestionItemCard';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { AddItemsDialog } from './AddItemsDialog';

interface EditSuggestionDialogProps {
  suggestion: EnvironmentSuggestion;
  onRevoke: (itemId: string) => Promise<void>;
  onItemsAdded: () => void;
  onClose: () => void;
}

const SECTION_ORDER: SuggestionItemType[] = ['annotation', 'highlight', 'dossier', 'quickNorm', 'alias'];
const SECTION_LABEL: Record<SuggestionItemType, string> = {
  annotation: 'Note', highlight: 'Evidenze', dossier: 'Dossier',
  quickNorm: 'Norme veloci', alias: 'Alias',
};

export function EditSuggestionDialog({ suggestion, onRevoke, onItemsAdded, onClose }: EditSuggestionDialogProps) {
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showRevokeAll, setShowRevokeAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(() => {
    const acc: Record<SuggestionItemType, SuggestionItem[]> = {
      annotation: [], highlight: [], dossier: [], quickNorm: [], alias: [],
    };
    for (const i of suggestion.items) acc[i.itemType].push(i);
    return acc;
  }, [suggestion.items]);

  const handleRevoke = async (id: string) => {
    setBusy(true);
    try { await onRevoke(id); } finally { setBusy(false); setPendingRevokeId(null); }
  };

  const handleRevokeAll = async () => {
    setBusy(true);
    try {
      for (const item of suggestion.items) {
        if (item.status === 'pending') await onRevoke(item.id);
      }
    } finally {
      setBusy(false);
      setShowRevokeAll(false);
    }
  };

  const pendingCount = suggestion.counts.pending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Suggerimento a @{suggestion.sharedEnvironment?.user.username}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              "{suggestion.sharedEnvironment?.title}" · Stato:
              {' '}{suggestion.counts.pending} pending ·
              {' '}{suggestion.counts.taken} prese ·
              {' '}{suggestion.counts.declined} rifiutate
            </p>
            {suggestion.message && (
              <p className="mt-2 text-sm italic text-slate-700 dark:text-slate-300">"{suggestion.message}"</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {SECTION_ORDER.map((type) => {
            const items = grouped[type];
            if (items.length === 0) return null;
            return (
              <div key={type}>
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                  {SECTION_LABEL[type]} ({items.length})
                </h3>
                <div className="space-y-2">
                  {items.map(item => (
                    <SuggestionItemCard
                      key={item.id}
                      item={item}
                      actions={
                        <button
                          onClick={() => setPendingRevokeId(item.id)}
                          title="Revoca"
                          disabled={busy}
                          className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                        >
                          <Trash2 size={16} />
                        </button>
                      }
                      footer={item.status === 'declined' && item.reviewNote ? (
                        <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">
                          Risposta: "{item.reviewNote}"
                        </p>
                      ) : null}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {suggestion.items.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-6">
              Nessun item — il suggerimento è stato revocato.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              <Plus size={14} /> Aggiungi item
            </button>
            {pendingCount > 0 && (
              <button
                onClick={() => setShowRevokeAll(true)}
                disabled={busy}
                className="px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-50"
              >
                Revoca tutti pending
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            Chiudi
          </button>
        </div>
      </div>

      {showAdd && (
        <AddItemsDialog
          suggestionId={suggestion.id}
          onAdded={() => { setShowAdd(false); onItemsAdded(); }}
          onClose={() => setShowAdd(false)}
        />
      )}

      {pendingRevokeId && (
        <ConfirmDialog
          open
          variant="danger"
          title="Revocare questo item?"
          message="L'item verrà rimosso dal thread e l'autore non potrà più prenderlo."
          confirmLabel="Revoca"
          onConfirm={() => handleRevoke(pendingRevokeId)}
          onCancel={() => setPendingRevokeId(null)}
        />
      )}

      {showRevokeAll && (
        <ConfirmDialog
          open
          variant="danger"
          title={`Revocare ${pendingCount} item pending?`}
          message="Solo gli item non ancora revisionati verranno rimossi. Le decisioni già prese dall'autore restano."
          confirmLabel="Revoca tutti"
          onConfirm={handleRevokeAll}
          onCancel={() => setShowRevokeAll(false)}
        />
      )}
    </div>
  );
}
