import { useEffect, useId, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { EnvironmentSuggestion, SuggestionItem, SuggestionItemType } from '../../../types';
import { SuggestionItemCard } from './SuggestionItemCard';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { Expand } from '../../ui/Expand';
import { CONTROL_BORDER, CONTROL_RADIUS } from '../../ui/controlStyles';
import { AddItemsDialog } from './AddItemsDialog';
import { ForumSpace } from './ForumSpace';
import { itemName } from './suggestionItemName';

interface EditSuggestionDialogProps {
  /** The sent suggestion edited; null, closed. */
  suggestion: EnvironmentSuggestion | null;
  onRevoke: (itemId: string) => Promise<void>;
  onItemsAdded: () => void;
  onClose: () => void;
}

const SECTION_ORDER: SuggestionItemType[] = ['annotation', 'highlight', 'dossier', 'quickNorm', 'alias'];
const SECTION_LABEL: Record<SuggestionItemType, string> = {
  annotation: 'Note', highlight: 'Evidenze', dossier: 'Dossier',
  quickNorm: 'Norme veloci', alias: 'Alias',
};

/**
 * A sent suggestion, in the page at the top of Suggerimenti (LC140, L-73; it was a window with a veil): its items, each
 * to revoke, and «Aggiungi item», which opens its form under the command. A revocation cannot be undone: it keeps its
 * confirmation, grown from its button, and the focus comes back to the space once the item is gone.
 */
export function EditSuggestionDialog({ suggestion, onClose, ...rest }: EditSuggestionDialogProps) {
  const spaceId = useId();
  return (
    <ForumSpace
      id={spaceId}
      value={suggestion}
      onClose={onClose}
      title={(s) => `Suggerimento a @${s.sharedEnvironment?.user.username ?? ''}`}
      line={(s) => `«${s.sharedEnvironment?.title ?? ''}» · ${s.counts.pending} in attesa · ${s.counts.taken} prese · ${s.counts.declined} rifiutate`}
    >
      {(s, setBusy) => <Edit suggestion={s} spaceId={spaceId} setBusy={setBusy} {...rest} />}
    </ForumSpace>
  );
}

function Edit({ suggestion, spaceId, setBusy: setSpaceBusy, onRevoke, onItemsAdded }:
  Omit<EditSuggestionDialogProps, 'suggestion' | 'onClose'> & { suggestion: EnvironmentSuggestion; spaceId: string; setBusy: (busy: boolean) => void }) {
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [showRevokeAll, setShowRevokeAll] = useState(false);
  // The button a revocation's confirmation grows from and gives the focus back to (LC85).
  const [revokeFrom, setRevokeFrom] = useState<HTMLElement | null>(null);
  const [busy, setOwnBusy] = useState(false);
  const setBusy = (value: boolean) => { setOwnBusy(value); setSpaceBusy(value); };
  const space = () => document.getElementById(spaceId);

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

  // Read again after a revocation, the item goes with the button that had the focus: the focus waits on the space.
  useEffect(() => {
    if (document.activeElement === document.body) document.getElementById(spaceId)?.focus({ preventScroll: true });
  }, [suggestion.items, spaceId]);

  const pendingCount = suggestion.counts.pending;

  return (
    <>
      {suggestion.message && (
        <p className="text-sm italic text-slate-700 dark:text-slate-300">«{suggestion.message}»</p>
      )}
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
                    <IconButton
                      onClick={(event) => { setRevokeFrom(event.currentTarget); setPendingRevokeId(item.id); }}
                      aria-label={`Revoca ${itemName(item)}`}
                      disabled={busy}
                      icon={<Trash2 aria-hidden />}
                      className="hover:text-red-600"
                    />
                  }
                  footer={item.status === 'declined' && item.reviewNote ? (
                    <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">
                      Risposta: «{item.reviewNote}»
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
          Nessun elemento: il suggerimento è stato revocato.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setShowAdd(true)} aria-expanded={showAdd} icon={<Plus size={14} aria-hidden />}>
          Aggiungi item
        </Button>
        {pendingCount > 0 && (
          <Button
            variant="quiet"
            onClick={(event) => { setRevokeFrom(event.currentTarget); setShowRevokeAll(true); }}
            disabled={busy}
            className="text-red-700 dark:text-red-400"
          >
            Revoca tutti gli item in attesa
          </Button>
        )}
      </div>

      {/* «Aggiungi item»: its form opens under the command, inside the editing (LC140, L-73). */}
      <Expand
        open={showAdd}
        onClose={() => { if (!addBusy) setShowAdd(false); }}
        role="region"
        aria-label="Aggiungi item al suggerimento"
        className={`${CONTROL_RADIUS} ${CONTROL_BORDER} p-3`}
      >
        <div className="space-y-4">
          <AddItemsDialog
            suggestionId={suggestion.id}
            onAdded={() => { setShowAdd(false); onItemsAdded(); }}
            onClose={() => setShowAdd(false)}
            setBusy={(value) => { setAddBusy(value); setSpaceBusy(value); }}
          />
        </div>
      </Expand>

      <ConfirmDialog
        open={pendingRevokeId !== null}
        variant="danger"
        title="Revocare questo item?"
        message="L'item verrà rimosso dal thread e l'autore non potrà più prenderlo."
        confirmLabel="Revoca"
        focusCancel
        origin={revokeFrom}
        focusBack={space}
        onConfirm={() => { if (pendingRevokeId) void handleRevoke(pendingRevokeId); }}
        onCancel={() => setPendingRevokeId(null)}
      />

      <ConfirmDialog
        open={showRevokeAll}
        variant="danger"
        title={`Revocare ${pendingCount} item in attesa?`}
        message="Solo gli item non ancora revisionati verranno rimossi. Le decisioni già prese dall'autore restano."
        confirmLabel="Revoca tutti"
        focusCancel
        onConfirm={() => void handleRevokeAll()}
        origin={revokeFrom}
        focusBack={space}
        onCancel={() => setShowRevokeAll(false)}
      />
    </>
  );
}
