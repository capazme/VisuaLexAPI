import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, X as XIcon, FileText, Highlighter, Folder, Zap, Link2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import type { EnvironmentSuggestion, SuggestionItem, SuggestionItemType } from '../../../types';
import { SuggestionItemCard } from './SuggestionItemCard';
import { itemName } from './suggestionItemName';
import { ForumSpace } from './ForumSpace';
import { AliasConflictDialog, type AliasChoice } from './AliasConflictDialog';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { Textarea } from '../../ui/Textarea';
import { Expand } from '../../ui/Expand';
import { CONTROL_BORDER, CONTROL_RADIUS } from '../../ui/controlStyles';

export type TakeResult =
  | { kind: 'ok' }
  | { kind: 'alias_conflict'; itemId: string; suggestedTrigger: string; existingAliasId?: string }
  | { kind: 'error'; message: string };

export interface AliasConflict { itemId: string; suggestedTrigger: string; existingAliasId?: string }

interface SuggestionReviewDialogProps {
  /** The received suggestion reviewed; null, closed. */
  suggestion: EnvironmentSuggestion | null;
  onTake: (itemId: string) => Promise<TakeResult>;
  onDecline: (itemId: string, reviewNote?: string) => Promise<void>;
  /** A 409 on an alias item's «Prendi»: the choice opens under that item. */
  aliasConflict: AliasConflict | null;
  /** True when the choice stays open (another 409 on the new trigger). */
  onAliasChoose: (choice: AliasChoice) => Promise<boolean>;
  onAliasCancel: () => void;
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

/**
 * A received suggestion's review, in the page at the top of Suggerimenti (LC140, L-73; it was a window with a veil):
 * its items grouped by kind, each to take or decline. «Rifiuta» opens its note under the item; an alias whose trigger
 * the user already has opens the choice under the item. While the server works the focus waits on the space, since the
 * pressed button goes with the item's new state.
 */
export function SuggestionReviewDialog({ suggestion, onClose, ...rest }: SuggestionReviewDialogProps) {
  const spaceId = useId();
  return (
    <ForumSpace
      id={spaceId}
      value={suggestion}
      onClose={onClose}
      title={(s) => `Suggerimento da @${s.suggester.username}`}
      line={(s) => `per «${s.sharedEnvironment?.title ?? ''}» · ${new Date(s.createdAt).toLocaleDateString('it-IT')} · ${s.counts.taken + s.counts.declined}/${s.items.length} revisionati`}
    >
      {(s, setBusy) => <Review suggestion={s} spaceId={spaceId} setBusy={setBusy} {...rest} />}
    </ForumSpace>
  );
}

function Review({ suggestion, spaceId, setBusy, onTake, onDecline, aliasConflict, onAliasChoose, onAliasCancel }:
  Omit<SuggestionReviewDialogProps, 'suggestion' | 'onClose'> & { suggestion: EnvironmentSuggestion; spaceId: string; setBusy: (busy: boolean) => void }) {
  const [declineTargetId, setDeclineTargetId] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState('');
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [aliasBusy, setAliasBusy] = useState(false);
  // «Prendi» refused: what happened, under its item.
  const [takeError, setTakeError] = useState<{ itemId: string; message: string } | null>(null);
  // «Prendi» waited disabled: once drawn enabled again, the focus goes back to it.
  const refocusTake = useRef<string | null>(null);
  // The last conflict, kept while its choice closes: the closing shows it, not an empty box.
  const [shownConflict, setShownConflict] = useState(aliasConflict);
  if (aliasConflict && aliasConflict !== shownConflict) setShownConflict(aliasConflict);
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

  const takeId = (itemId: string) => `${spaceId}-take-${itemId}`;
  const focusSpace = () => document.getElementById(spaceId)?.focus({ preventScroll: true });
  const working = (itemId: string | null) => {
    setBusyItemId(itemId);
    setBusy(itemId !== null);
    if (itemId) focusSpace();
  };

  const handleTake = async (itemId: string) => {
    working(itemId);
    setTakeError(null);
    try {
      const result = await onTake(itemId);
      if (result.kind === 'error') {
        setTakeError({ itemId, message: result.message });
        refocusTake.current = itemId;
      }
    } finally {
      working(null);
    }
  };

  const closeDecline = () => { setDeclineTargetId(null); setDeclineNote(''); };
  const handleConfirmDecline = async () => {
    if (!declineTargetId) return;
    working(declineTargetId);
    try {
      await onDecline(declineTargetId, declineNote.trim() || undefined);
    } finally {
      working(null);
      closeDecline();
    }
  };

  // «Prendi» was disabled as the choice opened: the focus goes back to it by hand, or to the space once it is gone.
  const backToTake = (itemId: string) => {
    const take = document.getElementById(takeId(itemId)) as HTMLButtonElement | null;
    if (take && !take.disabled) take.focus({ preventScroll: true });
    else focusSpace();
  };
  useEffect(() => {
    const itemId = refocusTake.current;
    if (itemId === null || busyItemId !== null) return;
    refocusTake.current = null;
    backToTake(itemId);
  });
  const cancelAlias = () => {
    if (aliasBusy || !aliasConflict) return;
    backToTake(aliasConflict.itemId);
    onAliasCancel();
  };
  const chooseAlias = async (choice: AliasChoice) => {
    if (!aliasConflict) return;
    const { itemId } = aliasConflict;
    if (choice.action === 'skip') { backToTake(itemId); onAliasCancel(); return; }
    setAliasBusy(true);
    setBusy(true);
    let stays = false;
    try {
      stays = await onAliasChoose(choice);
    } finally {
      setAliasBusy(false);
      setBusy(false);
      // The item taken, its «Prendi» goes: the focus waits on the review. Still open, it stays in the choice.
      if (!stays) focusSpace();
    }
  };

  return (
    <>
      {suggestion.message && (
        <p className="text-sm italic text-slate-700 dark:text-slate-300 max-w-prose">«{suggestion.message}»</p>
      )}
      {SECTION_ORDER.map((type) => {
        const items = grouped[type];
        if (items.length === 0) return null;
        const { label, Icon } = SECTION_META[type];
        const isOpen = expanded[type];
        return (
          <div key={type}>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => setExpanded(prev => ({ ...prev, [type]: !prev[type] }))}
              aria-expanded={isOpen}
              icon={isOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
              className="font-medium"
            >
              <Icon size={16} aria-hidden />
              {label} ({items.length})
            </Button>
            {isOpen && (
              <div className="mt-2 space-y-2">
                {items.map(item => {
                  const name = itemName(item);
                  const conflict = shownConflict?.itemId === item.id ? shownConflict : null;
                  return (
                    <div key={item.id}>
                      <SuggestionItemCard
                        item={item}
                        actions={
                          <>
                            <IconButton
                              id={takeId(item.id)}
                              onClick={() => void handleTake(item.id)}
                              disabled={busyItemId === item.id}
                              aria-label={`Prendi ${name}`}
                              icon={<Check aria-hidden />}
                              className="text-green-700 dark:text-green-300"
                            />
                            <IconButton
                              onClick={() => { setDeclineTargetId(item.id); setDeclineNote(''); }}
                              disabled={busyItemId === item.id}
                              aria-label={`Rifiuta ${name}`}
                              aria-expanded={declineTargetId === item.id}
                              icon={<XIcon aria-hidden />}
                              className="text-red-700 dark:text-red-300"
                            />
                          </>
                        }
                        footer={item.status === 'declined' && item.reviewNote ? (
                          <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">
                            Nota: «{item.reviewNote}»
                          </p>
                        ) : null}
                      />
                      {takeError?.itemId === item.id && item.status === 'pending' && (
                        <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">{takeError.message}</p>
                      )}
                      {/* «Rifiuta»: the note opens under the item (LC140, L-73). */}
                      <Expand
                        open={declineTargetId === item.id && item.status === 'pending'}
                        onClose={() => { if (busyItemId !== item.id) closeDecline(); }}
                        role="region"
                        aria-label={`Rifiuta ${name}`}
                        className={`mt-2 ${CONTROL_RADIUS} ${CONTROL_BORDER} p-3`}
                      >
                        <Textarea
                          label="Nota per chi ha suggerito (facoltativa)"
                          value={declineNote}
                          onChange={(e) => setDeclineNote(e.target.value.slice(0, 500))}
                          rows={3}
                          className="resize-none"
                        />
                        <p className="text-xs text-slate-500 text-right">{declineNote.length}/500</p>
                        <div className="mt-2 flex justify-end gap-2">
                          <Button variant="quiet" onClick={closeDecline} disabled={busyItemId === item.id}>Annulla</Button>
                          <Button variant="danger" onClick={() => void handleConfirmDecline()} loading={busyItemId === item.id}>
                            Conferma rifiuto
                          </Button>
                        </div>
                      </Expand>
                      {/* An alias whose trigger the user already has: the choice opens under the item (LC140, L-73). */}
                      <Expand
                        open={aliasConflict?.itemId === item.id}
                        onClose={cancelAlias}
                        role="region"
                        aria-label="Trigger già in uso"
                        className={`mt-2 ${CONTROL_RADIUS} ${CONTROL_BORDER} p-3`}
                      >
                        {conflict && (
                          <>
                            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                              <AlertTriangle size={16} aria-hidden className="shrink-0 text-amber-500" />
                              Trigger già in uso
                            </p>
                            <AliasConflictDialog
                              suggestedTrigger={conflict.suggestedTrigger}
                              busy={aliasBusy}
                              onChoose={(choice) => void chooseAlias(choice)}
                              onClose={cancelAlias}
                            />
                          </>
                        )}
                      </Expand>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
