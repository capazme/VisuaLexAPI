import { useCallback, useContext, useEffect, useMemo } from 'react';
import type { Highlight, Proposal } from '../types';
import { proposalHighlight } from '../utils/aiReview';
import {
  assistantProposalsStore, editProposalNote, flushRemovals, loadProposals, moveProposal, removeProposal, setProposalState,
} from '../store/assistantProposals';
import type { ProposalActions } from '../components/features/search/BlockAnnotationsPopover';
import { CurrentDossierContext } from '../components/features/dossier/currentDossier';

const NONE: Highlight[] = [];

/**
 * What an application proposed on one dossier entry (D7b), for the reader that shows it: its proposals drawn as
 * highlights under the reader's keys, and what the popover does with them through the entry's routes. Nothing outside
 * a dossier entry (no `itemId` or no dossier on the page), with the feature off, or on a text shown read-only (the
 * server refuses proposals there).
 */
export function useEntryProposals(itemId: string | undefined, normaKey: string, articleId: string, readOnly = false) {
  const dossierId = useContext(CurrentDossierContext);
  const enabled = assistantProposalsStore((s) => s.enabled);
  const proposals = assistantProposalsStore((s) => (itemId ? s.byItem[itemId] : undefined));
  // The dossier to ask, or null when this reader asks nothing.
  const proposalsOf = enabled && itemId && !readOnly ? dossierId : null;

  useEffect(() => {
    if (!proposalsOf || !itemId) return;
    void loadProposals(proposalsOf, itemId);
    // The reader goes (its row closed): a removal waiting behind «Annulla» is sent now, so opening the row again reads
    // what the server holds.
    return () => flushRemovals(itemId);
  }, [proposalsOf, itemId]);

  const highlights = useMemo(
    () => (proposalsOf && proposals ? proposals.map((p) => proposalHighlight(p, normaKey, articleId)) : NONE),
    [proposalsOf, proposals, normaKey, articleId],
  );

  // «Sposta l'evidenziazione»: the passage whose new words this reader is asking for — one on the page at a time —,
  // while it is still there: binned meanwhile (or the feature off), the move ends.
  const movingRef = assistantProposalsStore((s) => (itemId && s.moving?.itemId === itemId ? s.moving : null));
  const movingId = movingRef?.proposalId ?? null;
  const moving: Proposal | null = (movingId && proposalsOf && proposals?.find((p) => p.id === movingId)) || null;
  useEffect(() => {
    if (movingId && !moving) assistantProposalsStore.setState({ moving: null });
  }, [movingId, moving]);

  const actions = useMemo<ProposalActions | undefined>(() => {
    if (!proposalsOf || !itemId) return undefined;
    const d = proposalsOf;
    return {
      validate: (id, validated) => void setProposalState(d, itemId, id, validated ? 'validated' : 'proposed'),
      flag: (id, flagged) => void setProposalState(d, itemId, id, flagged ? 'review' : 'proposed'),
      comment: (id, text) => void setProposalState(d, itemId, id, 'review', text),
      editNote: (id, text) => void editProposalNote(d, itemId, id, text),
      remove: (id) => removeProposal(d, itemId, id),
      move: (id) => assistantProposalsStore.setState({ moving: { itemId, proposalId: id } }),
    };
  }, [proposalsOf, itemId]);

  /** The new boundaries, from the selection in the reader's text root (`getSelectionAnchor`, the reader's projection). */
  const saveMove = useCallback((startOffset: number, text: string) => {
    if (proposalsOf && itemId && movingId) void moveProposal(proposalsOf, itemId, movingId, startOffset, text);
    assistantProposalsStore.setState({ moving: null });
  }, [proposalsOf, itemId, movingId]);
  const cancelMove = useCallback(() => assistantProposalsStore.setState({ moving: null }), []);

  return { highlights, actions, moving, saveMove, cancelMove };
}
