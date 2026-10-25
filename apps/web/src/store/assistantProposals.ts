import { create } from 'zustand';
import { assistantService } from '../services/assistantService';
import { appStore } from './useAppStore';
import { closeNotification, notify, UNDO_MS } from '../components/ui/notifications/notifications';
import type { AiReviewState, DossierItem, Proposal } from '../types';
import { dossierItemFromApi } from '../components/features/dossier/dossierUtils';
import type { DossierItemApi } from '../services/dossierService';
import { shiftAiReviewCount } from '../utils/aiReview';

/**
 * What applications proposed on dossier entries (D7b, the server's contract): a store of its own, keyed by entry id,
 * filled by the entry's reader from `…/proposals`. The marks never enter the app's highlights, so no other reader —
 * Study Mode, the Forum, environments, the PDF — ever receives one.
 */
interface AssistantProposalsState {
  /** `GET /api/features`: off until the server says on; a 404 from a route turns it off again. */
  enabled: boolean;
  byItem: Record<string, Proposal[]>;
  /** The proposals and note entries with a write out, by id: their checkbox and flag wait for it. */
  busy: Record<string, true>;
}

export const assistantProposalsStore = create<AssistantProposalsState>()(() => ({ enabled: false, byItem: {}, busy: {} }));

// What `apiClient` rejects with, once its interceptor has read the answer: `{ status, message, data }`.
const errorDetail = (error: unknown, fallback: string): string => {
  const detail = (error as { data?: { detail?: unknown } } | null)?.data?.detail;
  return typeof detail === 'string' && detail ? detail : fallback;
};
const isNotFound = (error: unknown, detail: string) =>
  (error as { status?: number } | null)?.status === 404 && errorDetail(error, '') === detail;
const isSwitchedOff = (error: unknown) => isNotFound(error, 'Non disponibile');
/** The server no longer has it (removed in another tab): as good as removed, no error to show. */
const isGone = (error: unknown) => isNotFound(error, 'Proposta non trovata');

/**
 * Removals waiting for their notification to close, by proposal: sent at once when their reader or the page goes.
 * `update` takes a write's answer that lands meanwhile, so «Annulla» puts back the server's state, not the old one.
 */
const pendingRemovals = new Map<string, { itemId: string; send: (onExit?: boolean) => void; update: (p: Proposal) => void }>();
/** Removals sent and not yet answered: a reading meanwhile does not draw them back. */
const removalsInFlight = new Set<string>();
/** Bumped at logout: an answer to a request made before it is not taken. */
let generation = 0;
/** Switched off during the session: the items' counts were cleared, and are read again once it is on. */
let clearedByOff = false;

/**
 * The writes out, by proposal or note entry: each action numbers itself and only the latest one's answer is taken (an
 * earlier answer landing after it is dropped), so the last action wins whatever order the answers come in.
 */
const writeSeq = new Map<string, number>();

function startWrite(id: string): number {
  const mine = (writeSeq.get(id) ?? 0) + 1;
  writeSeq.set(id, mine);
  assistantProposalsStore.setState((s) => ({ busy: { ...s.busy, [id]: true } }));
  return mine;
}

const isLatest = (id: string, mine: number) => writeSeq.get(id) === mine;

function endWrite(id: string, mine: number) {
  if (!isLatest(id, mine)) return;
  assistantProposalsStore.setState((s) => {
    const busy = { ...s.busy };
    delete busy[id];
    return { busy };
  });
}

/**
 * Off, now or from a route's 404 «Non disponibile»: the proposals go, and so do the states the dossier's items carry
 * (the rows' lights, the note entries' controls) until the server says on again.
 */
function switchOff() {
  assistantProposalsStore.setState({ enabled: false, byItem: {}, busy: {} });
  clearedByOff = true;
  appStore.setState((s) => {
    for (const d of s.dossiers) {
      for (const item of d.items) {
        if (item.assistantNotes) item.assistantNotes = null;
        if (item.assistantNote) item.assistantNote = null;
      }
    }
  });
}

/** At logout: nothing of the last account's dossiers stays in memory. */
export function resetAssistantProposals() {
  generation++;
  featuresInFlight = null;
  clearedByOff = false;
  pendingRemovals.clear();
  removalsInFlight.clear();
  writeSeq.clear();
  assistantProposalsStore.setState({ enabled: false, byItem: {}, busy: {} });
}

let featuresInFlight: Promise<void> | null = null;

/** Read as the app starts and as the dossier page mounts; no polling. Calls made while one is in flight share it. */
export function loadAssistantFeatures(): Promise<void> {
  if (featuresInFlight) return featuresInFlight;
  const asked = generation;
  let request: Promise<void> | null = null;
  request = (async () => {
    try {
      const { assistantPassages } = await assistantService.features();
      if (asked !== generation) return;
      if (assistantPassages) {
        assistantProposalsStore.setState({ enabled: true });
        // On again after an off cleared the lights: the dossiers' answers carry them again.
        if (clearedByOff) {
          clearedByOff = false;
          void appStore.getState().refreshDossiers();
        }
      } else if (assistantProposalsStore.getState().enabled) switchOff();
    } catch {
      if (asked === generation) assistantProposalsStore.setState({ enabled: false });
    } finally {
      if (featuresInFlight === request) featuresInFlight = null;
    }
  })();
  featuresInFlight = request;
  return request;
}

export async function loadProposals(dossierId: string, itemId: string): Promise<void> {
  if (!assistantProposalsStore.getState().enabled) return;
  try {
    const proposals = await assistantService.listProposals(dossierId, itemId);
    // One waiting behind «Annulla», or removed and not yet answered, is not back: the server still has it.
    const shown = proposals.filter((p) => !pendingRemovals.has(p.id) && !removalsInFlight.has(p.id));
    assistantProposalsStore.setState((s) => ({ byItem: { ...s.byItem, [itemId]: shown } }));
  } catch (error) {
    if (isSwitchedOff(error)) switchOff();
  }
}

function moveCount(dossierId: string, itemId: string, from: AiReviewState | null, to: AiReviewState | null) {
  if (from === to) return;
  appStore.setState((s) => {
    shiftAiReviewCount(s.dossiers.find((d) => d.id === dossierId)?.items.find((i) => i.id === itemId), from, to);
  });
}

function replace(itemId: string, next: Proposal) {
  assistantProposalsStore.setState((s) => ({
    byItem: { ...s.byItem, [itemId]: (s.byItem[itemId] ?? []).map((p) => (p.id === next.id ? next : p)) },
  }));
}

const stateOf = (itemId: string, proposalId: string): AiReviewState | null =>
  assistantProposalsStore.getState().byItem[itemId]?.find((p) => p.id === proposalId)?.note?.state ?? null;

/** Gone from the server: gone here too, its count off the light, quietly. */
function dropGone(dossierId: string, itemId: string, proposalId: string) {
  const gone = assistantProposalsStore.getState().byItem[itemId]?.find((p) => p.id === proposalId);
  if (!gone) return;
  assistantProposalsStore.setState((s) => ({ byItem: { ...s.byItem, [itemId]: (s.byItem[itemId] ?? []).filter((p) => p.id !== proposalId) } }));
  moveCount(dossierId, itemId, gone.note?.state ?? null, null);
}

async function write(dossierId: string, itemId: string, proposalId: string, run: () => Promise<Proposal>) {
  const mine = startWrite(proposalId);
  try {
    const next = await run();
    if (!isLatest(proposalId, mine)) return;
    // Binned meanwhile: «Annulla» will put back this state, the server's.
    const pending = pendingRemovals.get(proposalId);
    if (pending) {
      pending.update(next);
      return;
    }
    // Removed for good meanwhile: nothing to draw or count.
    if (!assistantProposalsStore.getState().byItem[itemId]?.some((p) => p.id === proposalId)) return;
    // The state it had is read as the answer lands, not as the request left.
    const before = stateOf(itemId, proposalId);
    replace(itemId, next);
    moveCount(dossierId, itemId, before, next.note?.state ?? null);
  } catch (error) {
    if (!isLatest(proposalId, mine)) return;
    if (isSwitchedOff(error)) switchOff();
    else if (isGone(error)) dropGone(dossierId, itemId, proposalId);
    else notify({ type: 'error', message: errorDetail(error, 'Modifica non salvata'), duration: 5000 });
  } finally {
    endWrite(proposalId, mine);
  }
}

export function setProposalState(dossierId: string, itemId: string, proposalId: string, state: AiReviewState, comment?: string | null) {
  return write(dossierId, itemId, proposalId, () => assistantService.setProposalState(dossierId, itemId, proposalId, state, comment));
}

/** The pencil: saving the note validates it, «Validato, modificato da te». */
export function editProposalNote(dossierId: string, itemId: string, proposalId: string, text: string) {
  return write(dossierId, itemId, proposalId, () => assistantService.editProposalNote(dossierId, itemId, proposalId, text));
}

// Sent as the page goes (`pagehide`) or is hidden (`visibilitychange`): a phone's browser often discards a tab in the
// background without a `pagehide`. The cost: «Annulla» is gone once the tab is hidden (as `deferredRemovals`).
if (typeof window !== 'undefined') {
  const sendAllOnExit = () => {
    for (const { send } of [...pendingRemovals.values()]) send(true);
  };
  window.addEventListener('pagehide', sendAllOnExit);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendAllOnExit();
  });
}

/** The entry's reader goes (its row closed, the page left): what waits behind «Annulla» there is sent now. */
export function flushRemovals(itemId: string) {
  for (const { itemId: of, send } of [...pendingRemovals.values()]) if (of === itemId) send();
}

/**
 * The bin: the passage goes at once, the notification offers «Annulla», and the `DELETE` leaves when the notification
 * closes, the entry's reader goes, or the page goes; «Annulla» puts it back where it was, in the state the server last
 * gave. A refused `DELETE` puts it back with an error; one the server no longer has is simply gone.
 */
export function removeProposal(dossierId: string, itemId: string, proposalId: string) {
  const list = assistantProposalsStore.getState().byItem[itemId] ?? [];
  const index = list.findIndex((p) => p.id === proposalId);
  if (index === -1) return;
  let removed = list[index];
  // The light went down one as it was removed: putting it back always gives that one back.
  const putBack = () => {
    assistantProposalsStore.setState((s) => {
      const now = s.byItem[itemId] ?? [];
      if (now.some((p) => p.id === proposalId)) return s;
      const at = Math.min(index, now.length);
      return { byItem: { ...s.byItem, [itemId]: [...now.slice(0, at), removed, ...now.slice(at)] } };
    });
    moveCount(dossierId, itemId, null, removed.note?.state ?? null);
  };
  // So that a removal sent as the page goes carries a token still good (it is sent with no refresh).
  void assistantService.refreshForExit();
  assistantProposalsStore.setState((s) => ({ byItem: { ...s.byItem, [itemId]: (s.byItem[itemId] ?? []).filter((p) => p.id !== proposalId) } }));
  moveCount(dossierId, itemId, removed.note?.state ?? null, null);

  let settled = false;
  let notification: number | null = null;
  const send = (onExit = false) => {
    if (settled) return;
    settled = true;
    pendingRemovals.delete(proposalId);
    // Sent before its time (the reader or the page went): its «Annulla» goes too, since it could no longer undo.
    if (notification !== null) closeNotification(notification, 'external');
    // As the page goes an ordinary request is often cancelled: the exit's own keeps going.
    if (onExit) {
      assistantService.removeProposalOnExit(dossierId, itemId, proposalId);
      return;
    }
    removalsInFlight.add(proposalId);
    const gone = () => {
      removalsInFlight.delete(proposalId);
      // A reading made before the answer may still have drawn it: it is gone now.
      assistantProposalsStore.setState((s) => (s.byItem[itemId]?.some((p) => p.id === proposalId)
        ? { byItem: { ...s.byItem, [itemId]: s.byItem[itemId].filter((p) => p.id !== proposalId) } }
        : s));
    };
    assistantService.removeProposal(dossierId, itemId, proposalId)
      .then(gone)
      .catch((error) => {
        // Already gone from the server: what was wanted, no error and nothing put back.
        if (isGone(error)) return gone();
        removalsInFlight.delete(proposalId);
        putBack();
        notify({ type: 'error', message: errorDetail(error, 'Passaggio non rimosso'), duration: 5000 });
      });
  };
  pendingRemovals.set(proposalId, { itemId, send, update: (p) => { removed = p; } });
  notification = notify({
    type: 'info',
    message: 'Passaggio rimosso',
    duration: UNDO_MS,
    onUndo: () => {
      if (settled) return;
      settled = true;
      pendingRemovals.delete(proposalId);
      putBack();
    },
    // At logout every notification goes at once (`dropped`), and what it held is not carried out, now or later.
    onClose: (reason) => {
      if (reason === 'dropped') {
        settled = true;
        pendingRemovals.delete(proposalId);
      } else if (reason !== 'undo') send();
    },
  });
}

type NoteItem = Extract<DossierItem, { type: 'note' }>;

/**
 * A note entry an application wrote (contract §3): the server's answer replaces its text and its state, and the light
 * of the article it is about moves by one. The last action wins, as for a passage.
 */
async function writeNoteEntry(dossierId: string, note: NoteItem, run: () => Promise<DossierItemApi>) {
  const mine = startWrite(note.id);
  try {
    const next = dossierItemFromApi(await run());
    if (!isLatest(note.id, mine)) return;
    appStore.setState((s) => {
      const d = s.dossiers.find((x) => x.id === dossierId);
      const item = d?.items.find((i) => i.id === note.id);
      if (!d || !item || item.type !== 'note' || next.type !== 'note') return;
      // As for a passage: the state it had as the answer lands.
      const before = item.assistantNote?.state ?? null;
      item.data = next.data;
      item.assistantNote = next.assistantNote ?? null;
      if (item.aboutItemId) shiftAiReviewCount(d.items.find((i) => i.id === item.aboutItemId), before, item.assistantNote?.state ?? null);
    });
  } catch (error) {
    if (!isLatest(note.id, mine)) return;
    if (isSwitchedOff(error)) switchOff();
    else notify({ type: 'error', message: errorDetail(error, 'Modifica non salvata'), duration: 5000 });
  } finally {
    endWrite(note.id, mine);
  }
}

export function setNoteEntryState(dossierId: string, note: NoteItem, state: AiReviewState, comment?: string | null) {
  return writeNoteEntry(dossierId, note, () => assistantService.setNoteEntryState(dossierId, note.id, state, comment));
}

/** The pencil on a note entry: saving validates it, «Validato, modificato da te». */
export function editNoteEntryText(dossierId: string, note: NoteItem, text: string) {
  return writeNoteEntry(dossierId, note, () => assistantService.editNoteEntryText(dossierId, note.id, text));
}
