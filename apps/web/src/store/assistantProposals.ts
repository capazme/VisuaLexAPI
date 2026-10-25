import { create } from 'zustand';
import { assistantService } from '../services/assistantService';
import { appStore } from './useAppStore';
import { notify, UNDO_MS } from '../components/ui/notifications/notifications';
import type { AiReviewState, Proposal } from '../types';

/**
 * What applications proposed on dossier entries (D7b, the server's contract): a store of its own, keyed by entry id,
 * filled by the entry's reader from `…/proposals`. The marks never enter the app's highlights, so no other reader —
 * Study Mode, the Forum, environments, the PDF — ever receives one.
 */
interface AssistantProposalsState {
  /** `GET /api/features`: off until the server says on; a 404 from a route turns it off again. */
  enabled: boolean;
  byItem: Record<string, Proposal[]>;
}

export const assistantProposalsStore = create<AssistantProposalsState>()(() => ({ enabled: false, byItem: {} }));

const errorDetail = (error: unknown, fallback: string): string => {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' && detail ? detail : fallback;
};
const isNotFound = (error: unknown) => (error as { response?: { status?: number } })?.response?.status === 404;

/** A 404 from a route of the feature: it is off now. Its proposals and states go. */
function switchOff() {
  assistantProposalsStore.setState({ enabled: false, byItem: {} });
}

/** Read at app start and when the dossier page mounts; no polling. */
export async function loadAssistantFeatures(): Promise<void> {
  try {
    const { assistantPassages } = await assistantService.features();
    assistantProposalsStore.setState((s) => (assistantPassages ? { enabled: true } : { enabled: false, byItem: s.enabled ? {} : s.byItem }));
  } catch {
    assistantProposalsStore.setState({ enabled: false });
  }
}

export async function loadProposals(dossierId: string, itemId: string): Promise<void> {
  if (!assistantProposalsStore.getState().enabled) return;
  try {
    const proposals = await assistantService.listProposals(dossierId, itemId);
    assistantProposalsStore.setState((s) => ({ byItem: { ...s.byItem, [itemId]: proposals } }));
  } catch (error) {
    if (isNotFound(error) && errorDetail(error, '') === 'Non disponibile') switchOff();
  }
}

/** The row's light follows each write: the old state's count down one, the new one's up one (contract §5). */
function moveCount(dossierId: string, itemId: string, from: AiReviewState | null, to: AiReviewState | null) {
  if (from === to) return;
  appStore.setState((s) => {
    const item = s.dossiers.find((d) => d.id === dossierId)?.items.find((i) => i.id === itemId);
    if (!item) return;
    const counts = { proposed: 0, validated: 0, review: 0, ...(item.assistantNotes ?? {}) };
    if (from) counts[from] = Math.max(0, counts[from] - 1);
    if (to) counts[to] += 1;
    item.assistantNotes = counts.proposed + counts.validated + counts.review > 0 ? counts : null;
  });
}

function replace(itemId: string, next: Proposal) {
  assistantProposalsStore.setState((s) => ({
    byItem: { ...s.byItem, [itemId]: (s.byItem[itemId] ?? []).map((p) => (p.id === next.id ? next : p)) },
  }));
}

const stateOf = (itemId: string, proposalId: string): AiReviewState | null =>
  assistantProposalsStore.getState().byItem[itemId]?.find((p) => p.id === proposalId)?.note?.state ?? null;

async function write(dossierId: string, itemId: string, proposalId: string, run: () => Promise<Proposal>) {
  const before = stateOf(itemId, proposalId);
  try {
    const next = await run();
    replace(itemId, next);
    moveCount(dossierId, itemId, before, next.note?.state ?? null);
  } catch (error) {
    if (isNotFound(error) && errorDetail(error, '') === 'Non disponibile') switchOff();
    notify({ type: 'error', message: errorDetail(error, 'Modifica non salvata'), duration: 5000 });
  }
}

export function setProposalState(dossierId: string, itemId: string, proposalId: string, state: AiReviewState, comment?: string | null) {
  return write(dossierId, itemId, proposalId, () => assistantService.setProposalState(dossierId, itemId, proposalId, state, comment));
}

/** The pencil: saving the note validates it, «Validato, modificato da te». */
export function editProposalNote(dossierId: string, itemId: string, proposalId: string, text: string) {
  return write(dossierId, itemId, proposalId, () => assistantService.editProposalNote(dossierId, itemId, proposalId, text));
}

/** Removals waiting for their notification to close: sent at once when the page goes. */
const pendingRemovals = new Map<string, () => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const send of [...pendingRemovals.values()]) send();
  });
}

/**
 * The bin: the passage goes at once, the notification offers «Annulla», and the `DELETE` leaves when the notification
 * closes (or the page goes); «Annulla» puts it back where it was. A refused `DELETE` puts it back with an error.
 */
export function removeProposal(dossierId: string, itemId: string, proposalId: string) {
  const list = assistantProposalsStore.getState().byItem[itemId] ?? [];
  const index = list.findIndex((p) => p.id === proposalId);
  if (index === -1) return;
  const removed = list[index];
  const putBack = () => {
    assistantProposalsStore.setState((s) => {
      const now = s.byItem[itemId] ?? [];
      if (now.some((p) => p.id === proposalId)) return s;
      const at = Math.min(index, now.length);
      return { byItem: { ...s.byItem, [itemId]: [...now.slice(0, at), removed, ...now.slice(at)] } };
    });
    moveCount(dossierId, itemId, null, removed.note?.state ?? null);
  };
  assistantProposalsStore.setState((s) => ({ byItem: { ...s.byItem, [itemId]: (s.byItem[itemId] ?? []).filter((p) => p.id !== proposalId) } }));
  moveCount(dossierId, itemId, removed.note?.state ?? null, null);

  let sent = false;
  const send = () => {
    if (sent) return;
    sent = true;
    pendingRemovals.delete(proposalId);
    assistantService.removeProposal(dossierId, itemId, proposalId).catch((error) => {
      putBack();
      notify({ type: 'error', message: errorDetail(error, 'Passaggio non rimosso'), duration: 5000 });
    });
  };
  pendingRemovals.set(proposalId, send);
  notify({
    type: 'info',
    message: 'Passaggio rimosso',
    duration: UNDO_MS,
    onUndo: () => {
      sent = true;
      pendingRemovals.delete(proposalId);
      putBack();
    },
    // At logout every notification goes at once (`dropped`), and what it held is not carried out, now or at `pagehide`.
    onClose: (reason) => {
      if (reason === 'dropped') pendingRemovals.delete(proposalId);
      else if (reason !== 'undo') send();
    },
  });
}
