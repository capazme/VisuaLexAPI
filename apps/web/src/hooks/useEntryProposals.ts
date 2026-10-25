import { useContext, useEffect, useMemo } from 'react';
import type { Highlight } from '../types';
import { proposalHighlight } from '../utils/aiReview';
import {
  assistantProposalsStore, editProposalNote, flushRemovals, loadProposals, removeProposal, setProposalState,
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

  const actions = useMemo<ProposalActions | undefined>(() => {
    if (!proposalsOf || !itemId) return undefined;
    const d = proposalsOf;
    return {
      validate: (id, validated) => void setProposalState(d, itemId, id, validated ? 'validated' : 'proposed'),
      flag: (id, flagged) => void setProposalState(d, itemId, id, flagged ? 'review' : 'proposed'),
      comment: (id, text) => void setProposalState(d, itemId, id, 'review', text),
      editNote: (id, text) => void editProposalNote(d, itemId, id, text),
      remove: (id) => removeProposal(d, itemId, id),
    };
  }, [proposalsOf, itemId]);

  /** A removal from a list of the text's marks: a proposal's goes through its route, any other to `removeOwn`. */
  const isProposal = (id: string) => highlights.some((h) => h.id === id);
  return { highlights, actions, isProposal };
}
