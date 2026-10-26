import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/assistantService', () => ({
  assistantService: {
    features: vi.fn(), listProposals: vi.fn(), setProposalState: vi.fn(), editProposalNote: vi.fn(), moveProposal: vi.fn(), removeProposal: vi.fn(), removeProposalOnExit: vi.fn(), refreshForExit: vi.fn(async () => {}),
    setNoteEntryState: vi.fn(), editNoteEntryText: vi.fn(),
  },
}));

import { assistantService } from '../../services/assistantService';
import {
  assistantProposalsStore, editNoteEntryText, editProposalNote, flushRemovals, loadAssistantFeatures, loadProposals, moveProposal,
  removeProposal, resetAssistantProposals, setNoteEntryState, setProposalState,
} from '../assistantProposals';
import { appStore } from '../useAppStore';
import { notificationStore, closeNotification, undoNotification, resetNotifications } from '../../components/ui/notifications/notifications';
import { aiNote } from '../../utils/__fixtures__/assistantNote';
import type { Dossier, Proposal } from '../../types';

const proposal = (id: string, note: Proposal['note']): Proposal => ({
  id, normaKey: 'k::art::1453', text: 'contraenti', color: 'yellow', startOffset: 30, endOffset: 40, createdAt: '2026-10-25T09:00:00Z',
  dossierItemId: 'a1', proposedBy: { clientName: 'Claude Code' }, assistantRange: { startOffset: 30, text: 'contraenti' },
  rangeEdited: false, rangeEditedAt: null, rangeEditedBy: null, note,
});
const p1 = proposal('p1', aiNote('Il creditore.'));
const p2 = proposal('p2', null);
const dossier = {
  id: 'd1', name: 'Pratica', createdAt: '', items: [
    { id: 'a1', type: 'norma', addedAt: '', data: { tipo_atto: 'codice civile', numero_articolo: '1453' }, assistantNotes: { proposed: 1, validated: 0, review: 0 } },
    { id: 'n1', type: 'note', addedAt: '', data: 'Sul primo comma.', aboutItemId: 'a1', createdBy: { clientName: 'Claude Code' },
      assistantNote: { state: 'proposed', stateChangedAt: null, reviewComment: null, originalText: 'Sul primo comma.', edited: false, editedAt: null, editedBy: null } },
  ],
} as unknown as Dossier;
const counts = () => appStore.getState().dossiers[0].items[0].assistantNotes;
// As `apiClient`'s interceptor rejects: `{ status, message, data }`.
const refused = (status: number, detail: string) => ({ status, message: detail, data: { detail } });
const notFound = (detail: string) => refused(404, detail);
const lastNotification = () => notificationStore.getState().entries.at(-1)!;

beforeEach(() => {
  vi.mocked(assistantService.features).mockResolvedValue({ assistantPassages: true });
  vi.mocked(assistantService.listProposals).mockResolvedValue([p1, p2]);
  vi.mocked(assistantService.removeProposal).mockResolvedValue();
  // From nothing, as after a logout: no write, removal or switch-off of an earlier test carries over.
  resetAssistantProposals();
  appStore.setState({ dossiers: [structuredClone(dossier)] });
});

afterEach(() => {
  resetNotifications();
  vi.clearAllMocks();
});

describe('D7b proposals — the flag', () => {
  it('asks nothing while the feature is off, then loads an entry\'s proposals once it is on', async () => {
    await loadProposals('d1', 'a1');
    expect(assistantService.listProposals).not.toHaveBeenCalled();
    await loadAssistantFeatures();
    expect(assistantProposalsStore.getState().enabled).toBe(true);
    await loadProposals('d1', 'a1');
    expect(assistantService.listProposals).toHaveBeenCalledWith('d1', 'a1');
    expect(assistantProposalsStore.getState().byItem.a1).toEqual([p1, p2]);
  });

  it('a server that says off, or cannot be asked, leaves it off', async () => {
    vi.mocked(assistantService.features).mockResolvedValueOnce({ assistantPassages: false });
    await loadAssistantFeatures();
    expect(assistantProposalsStore.getState().enabled).toBe(false);
    vi.mocked(assistantService.features).mockRejectedValueOnce(new Error('rete'));
    await loadAssistantFeatures();
    expect(assistantProposalsStore.getState().enabled).toBe(false);
  });

  it('switched off since: a «Non disponibile» 404 hides every proposal, light and note state; another 404 does not', async () => {
    await loadAssistantFeatures();
    await loadProposals('d1', 'a1');
    vi.mocked(assistantService.listProposals).mockRejectedValueOnce(notFound('Voce non trovata'));
    await loadProposals('d1', 'other');
    expect(assistantProposalsStore.getState().enabled).toBe(true);
    vi.mocked(assistantService.setProposalState).mockRejectedValueOnce(notFound('Non disponibile'));
    await setProposalState('d1', 'a1', 'p1', 'validated');
    expect(assistantProposalsStore.getState()).toEqual({ enabled: false, byItem: {}, busy: {}, moving: null });
    expect(counts()).toBeNull();
    expect(appStore.getState().dossiers[0].items[1].assistantNote).toBeNull();
  });

  it('the server saying off, once on, switches off the same way', async () => {
    await loadAssistantFeatures();
    vi.mocked(assistantService.features).mockResolvedValueOnce({ assistantPassages: false });
    await loadAssistantFeatures();
    expect(assistantProposalsStore.getState().enabled).toBe(false);
    expect(counts()).toBeNull();
  });

  it('an answer to a request made before a logout is not taken', async () => {
    let answer: (v: { assistantPassages: boolean }) => void = () => {};
    vi.mocked(assistantService.features).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const asking = loadAssistantFeatures();
    resetAssistantProposals();
    answer({ assistantPassages: true });
    await asking;
    expect(assistantProposalsStore.getState().enabled).toBe(false);
  });

  it('on again after an off cleared the lights, the dossiers are read again for them', async () => {
    const refreshDossiers = vi.fn(async () => {});
    appStore.setState({ refreshDossiers });
    await loadAssistantFeatures();
    expect(refreshDossiers).not.toHaveBeenCalled();
    vi.mocked(assistantService.features).mockResolvedValueOnce({ assistantPassages: false });
    await loadAssistantFeatures();
    await loadAssistantFeatures();
    expect(refreshDossiers).toHaveBeenCalledTimes(1);
  });

  it('calls made while one is in flight share it', async () => {
    await Promise.all([loadAssistantFeatures(), loadAssistantFeatures(), loadAssistantFeatures()]);
    expect(assistantService.features).toHaveBeenCalledTimes(1);
  });

  it('a logout empties it, and a removal waiting is not sent as the page goes', async () => {
    await loadAssistantFeatures();
    await loadProposals('d1', 'a1');
    removeProposal('d1', 'a1', 'p1');
    resetAssistantProposals();
    expect(assistantProposalsStore.getState()).toEqual({ enabled: false, byItem: {}, busy: {}, moving: null });
    window.dispatchEvent(new Event('pagehide'));
    expect(assistantService.removeProposalOnExit).not.toHaveBeenCalled();
  });
});

describe('D7b proposals — the note\'s state', () => {
  beforeEach(async () => {
    await loadAssistantFeatures();
    await loadProposals('d1', 'a1');
  });

  it('takes the server\'s answer and moves the row\'s light: the old state down one, the new up one', async () => {
    vi.mocked(assistantService.setProposalState).mockResolvedValueOnce({ ...p1, note: aiNote('Il creditore.', 'review', { reviewComment: 'No.' }) });
    await setProposalState('d1', 'a1', 'p1', 'review', 'No.');
    expect(assistantService.setProposalState).toHaveBeenCalledWith('d1', 'a1', 'p1', 'review', 'No.');
    expect(assistantProposalsStore.getState().byItem.a1[0].note?.state).toBe('review');
    expect(counts()).toEqual({ proposed: 0, validated: 0, review: 1 });
  });

  it('the pencil saves the note; the answer, validated, moves the light too', async () => {
    vi.mocked(assistantService.editProposalNote).mockResolvedValueOnce({ ...p1, note: aiNote('Mia.', 'validated', { edited: true, assistantText: 'Il creditore.' }) });
    await editProposalNote('d1', 'a1', 'p1', 'Mia.');
    expect(assistantService.editProposalNote).toHaveBeenCalledWith('d1', 'a1', 'p1', 'Mia.');
    expect(assistantProposalsStore.getState().byItem.a1[0].note?.text).toBe('Mia.');
    expect(counts()).toEqual({ proposed: 0, validated: 1, review: 0 });
  });

  it('moving the boundaries takes the server\'s answer and leaves the light alone: the note keeps its state', async () => {
    const moved = { ...p1, text: 'i contraenti', startOffset: 28, endOffset: 40, rangeEdited: true, assistantRange: { startOffset: 30, text: 'contraenti' } };
    vi.mocked(assistantService.moveProposal).mockResolvedValueOnce(moved);
    await moveProposal('d1', 'a1', 'p1', 28, 'i contraenti');
    expect(assistantService.moveProposal).toHaveBeenCalledWith('d1', 'a1', 'p1', 28, 'i contraenti');
    expect(assistantProposalsStore.getState().byItem.a1[0]).toMatchObject({ startOffset: 28, text: 'i contraenti', rangeEdited: true });
    expect(counts()).toEqual({ proposed: 1, validated: 0, review: 0 });
  });

  it('a move on a passage removed elsewhere (another tab) says why nothing moved, and the passage goes', async () => {
    vi.mocked(assistantService.moveProposal).mockRejectedValueOnce(notFound('Proposta non trovata'));
    await moveProposal('d1', 'a1', 'p1', 28, 'i contraenti');
    expect(assistantProposalsStore.getState().byItem.a1.map((p) => p.id)).toEqual(['p2']);
    expect(lastNotification()).toMatchObject({ type: 'warning', message: 'Evidenziazione non spostata: il passaggio è stato rimosso altrove.' });
  });

  it('a move answered «Proposta non trovata» for a passage this tab no longer holds says nothing more', async () => {
    assistantProposalsStore.setState((st) => ({ byItem: { ...st.byItem, a1: st.byItem.a1.filter((p) => p.id !== 'p1') } }));
    vi.mocked(assistantService.moveProposal).mockRejectedValueOnce(notFound('Proposta non trovata'));
    await moveProposal('d1', 'a1', 'p1', 28, 'i contraenti');
    expect(notificationStore.getState().entries.some((e) => e.type === 'warning')).toBe(false);
  });

  it('two clicks in a row move the light once', async () => {
    const validated = { ...p1, note: aiNote('Il creditore.', 'validated') };
    vi.mocked(assistantService.setProposalState).mockResolvedValue(validated);
    await Promise.all([setProposalState('d1', 'a1', 'p1', 'validated'), setProposalState('d1', 'a1', 'p1', 'validated')]);
    expect(counts()).toEqual({ proposed: 0, validated: 1, review: 0 });
  });

  it('marks the passage busy while its write is out, and only then', async () => {
    let answer: (p: Proposal) => void = () => {};
    vi.mocked(assistantService.setProposalState).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const writing = setProposalState('d1', 'a1', 'p1', 'validated');
    expect(assistantProposalsStore.getState().busy).toEqual({ p1: true });
    answer({ ...p1, note: aiNote('Il creditore.', 'validated') });
    await writing;
    expect(assistantProposalsStore.getState().busy).toEqual({});
  });

  it('the last action wins: an earlier answer landing after it is dropped', async () => {
    const answers: ((p: Proposal) => void)[] = [];
    vi.mocked(assistantService.setProposalState).mockImplementation(() => new Promise((resolve) => { answers.push(resolve); }));
    const first = setProposalState('d1', 'a1', 'p1', 'validated');
    const second = setProposalState('d1', 'a1', 'p1', 'review', 'No.');
    // The second answers first, then the first.
    answers[1]({ ...p1, note: aiNote('Il creditore.', 'review', { reviewComment: 'No.' }) });
    await second;
    answers[0]({ ...p1, note: aiNote('Il creditore.', 'validated') });
    await first;
    expect(assistantProposalsStore.getState().byItem.a1[0].note?.state).toBe('review');
    expect(counts()).toEqual({ proposed: 0, validated: 0, review: 1 });
    expect(assistantProposalsStore.getState().busy).toEqual({});
  });

  it('one the server no longer has goes quietly, its count with it', async () => {
    vi.mocked(assistantService.setProposalState).mockRejectedValueOnce(notFound('Proposta non trovata'));
    await setProposalState('d1', 'a1', 'p1', 'validated');
    expect(assistantProposalsStore.getState().byItem.a1.map((p) => p.id)).toEqual(['p2']);
    expect(counts()).toBeNull();
    expect(notificationStore.getState().entries.some((e) => e.type === 'error')).toBe(false);
  });

  it('a refused write changes nothing and says why', async () => {
    vi.mocked(assistantService.setProposalState).mockRejectedValueOnce(refused(409, 'Questo passaggio non ha una nota'));
    await setProposalState('d1', 'a1', 'p1', 'validated');
    expect(assistantProposalsStore.getState().byItem.a1[0].note?.state).toBe('proposed');
    expect(counts()).toEqual({ proposed: 1, validated: 0, review: 0 });
    expect(lastNotification()).toMatchObject({ type: 'error', message: 'Questo passaggio non ha una nota' });
  });
});

describe('D7b proposals — the bin and «Annulla»', () => {
  beforeEach(async () => {
    await loadAssistantFeatures();
    await loadProposals('d1', 'a1');
  });

  it('goes at once, light down one; the DELETE leaves only as the notification closes', async () => {
    removeProposal('d1', 'a1', 'p1');
    expect(assistantProposalsStore.getState().byItem.a1.map((p) => p.id)).toEqual(['p2']);
    expect(counts()).toBeNull();
    const shown = lastNotification();
    expect(shown).toMatchObject({ message: 'Passaggio rimosso', undoable: true });
    expect(assistantService.removeProposal).not.toHaveBeenCalled();
    closeNotification(shown.id, 'timeout');
    expect(assistantService.removeProposal).toHaveBeenCalledWith('d1', 'a1', 'p1');
  });

  it('«Annulla» puts it back where it was, light and all, and sends nothing', async () => {
    removeProposal('d1', 'a1', 'p1');
    await undoNotification(lastNotification().id);
    expect(assistantProposalsStore.getState().byItem.a1.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(counts()).toEqual({ proposed: 1, validated: 0, review: 0 });
    expect(assistantService.removeProposal).not.toHaveBeenCalled();
  });

  it('a mark with no note leaves the light alone', () => {
    removeProposal('d1', 'a1', 'p2');
    expect(counts()).toEqual({ proposed: 1, validated: 0, review: 0 });
  });

  it('a refused DELETE puts it back with an error', async () => {
    vi.mocked(assistantService.removeProposal).mockRejectedValueOnce(refused(500, 'Errore del server'));
    removeProposal('d1', 'a1', 'p1');
    closeNotification(lastNotification().id, 'dismiss');
    await vi.waitFor(() => expect(assistantProposalsStore.getState().byItem.a1.map((p) => p.id)).toEqual(['p1', 'p2']));
    expect(lastNotification()).toMatchObject({ type: 'error', message: 'Errore del server' });
  });

  it('the page going sends it at once, by the exit\'s own request, and only once', () => {
    removeProposal('d1', 'a1', 'p1');
    window.dispatchEvent(new Event('pagehide'));
    expect(assistantService.removeProposalOnExit).toHaveBeenCalledWith('d1', 'a1', 'p1');
    // Its notification went with it; the page going again sends nothing more.
    expect(notificationStore.getState().entries.some((e) => e.message === 'Passaggio rimosso')).toBe(false);
    window.dispatchEvent(new Event('pagehide'));
    expect(assistantService.removeProposalOnExit).toHaveBeenCalledTimes(1);
    expect(assistantService.removeProposal).not.toHaveBeenCalled();
  });

  it('the tab hidden (a phone may discard it unannounced) sends it at once, as the page going does', () => {
    removeProposal('d1', 'a1', 'p1');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    expect(assistantService.removeProposalOnExit).toHaveBeenCalledWith('d1', 'a1', 'p1');
  });

  it('its reader going sends it at once, and takes its «Annulla» away; read again meanwhile, it is not drawn back', async () => {
    removeProposal('d1', 'a1', 'p1');
    // Read again while the notification still offers «Annulla»: the server still has it.
    await loadProposals('d1', 'a1');
    expect(assistantProposalsStore.getState().byItem.a1.map((p) => p.id)).toEqual(['p2']);
    flushRemovals('a1');
    expect(assistantService.removeProposal).toHaveBeenCalledWith('d1', 'a1', 'p1');
    expect(notificationStore.getState().entries.some((e) => e.message === 'Passaggio rimosso')).toBe(false);
    expect(counts()).toBeNull();
  });

  it('read while its DELETE is out, it is not drawn back; a refused DELETE then puts it back with its count', async () => {
    let refuse: (e: unknown) => void = () => {};
    vi.mocked(assistantService.removeProposal).mockReturnValueOnce(new Promise((_, reject) => { refuse = reject; }));
    removeProposal('d1', 'a1', 'p1');
    flushRemovals('a1');
    await loadProposals('d1', 'a1');
    expect(assistantProposalsStore.getState().byItem.a1.map((p) => p.id)).toEqual(['p2']);
    refuse(refused(500, 'Errore del server'));
    await vi.waitFor(() => expect(lastNotification()).toMatchObject({ type: 'error', message: 'Errore del server' }));
    expect(assistantProposalsStore.getState().byItem.a1.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(counts()).toEqual({ proposed: 1, validated: 0, review: 0 });
  });

  it('a DELETE refused after a logout puts nothing back and says nothing', async () => {
    let refuse: (e: unknown) => void = () => {};
    vi.mocked(assistantService.removeProposal).mockReturnValueOnce(new Promise((_, reject) => { refuse = reject; }));
    removeProposal('d1', 'a1', 'p1');
    flushRemovals('a1');
    resetAssistantProposals();
    refuse(refused(500, 'Errore del server'));
    await new Promise((r) => setTimeout(r, 0));
    expect(assistantProposalsStore.getState().byItem).toEqual({});
    expect(notificationStore.getState().entries.some((e) => e.type === 'error')).toBe(false);
  });

  it('ticked, binned before the answer, then «Annulla»: it comes back as the server has it, validated', async () => {
    let answer: (p: Proposal) => void = () => {};
    vi.mocked(assistantService.setProposalState).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const writing = setProposalState('d1', 'a1', 'p1', 'validated');
    removeProposal('d1', 'a1', 'p1');
    answer({ ...p1, note: aiNote('Il creditore.', 'validated') });
    await writing;
    await undoNotification(lastNotification().id);
    expect(assistantProposalsStore.getState().byItem.a1.find((p) => p.id === 'p1')?.note?.state).toBe('validated');
    expect(counts()).toEqual({ proposed: 0, validated: 1, review: 0 });
  });

  it('a DELETE the server answers «Proposta non trovata» is a removal done: no error, nothing put back', async () => {
    vi.mocked(assistantService.removeProposal).mockRejectedValueOnce(notFound('Proposta non trovata'));
    removeProposal('d1', 'a1', 'p1');
    closeNotification(lastNotification().id, 'timeout');
    await vi.waitFor(() => expect(assistantService.removeProposal).toHaveBeenCalled());
    await Promise.resolve();
    await Promise.resolve();
    expect(assistantProposalsStore.getState().byItem.a1.map((p) => p.id)).toEqual(['p2']);
    expect(counts()).toBeNull();
    expect(notificationStore.getState().entries.some((e) => e.type === 'error')).toBe(false);
  });

  it('a removal refreshes the token now, for an exit that could not', () => {
    removeProposal('d1', 'a1', 'p1');
    expect(assistantService.refreshForExit).toHaveBeenCalledTimes(1);
  });

  it('a write answered after the bin was pressed draws and counts nothing', async () => {
    let answer: (p: Proposal) => void = () => {};
    vi.mocked(assistantService.setProposalState).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const writing = setProposalState('d1', 'a1', 'p1', 'validated');
    removeProposal('d1', 'a1', 'p1');
    answer({ ...p1, note: aiNote('Il creditore.', 'validated') });
    await writing;
    expect(assistantProposalsStore.getState().byItem.a1.map((p) => p.id)).toEqual(['p2']);
    expect(counts()).toBeNull();
  });

  it('flushing another entry\'s reader sends nothing of this one', () => {
    removeProposal('d1', 'a1', 'p1');
    flushRemovals('other');
    expect(assistantService.removeProposal).not.toHaveBeenCalled();
  });

  it('at logout (every notification dropped) nothing is sent, not even as the page goes', () => {
    removeProposal('d1', 'a1', 'p1');
    resetNotifications();
    window.dispatchEvent(new Event('pagehide'));
    expect(assistantService.removeProposal).not.toHaveBeenCalled();
  });
});

describe('D7b — a note entry an application wrote', () => {
  const noteApi = (over: Record<string, unknown>) => ({
    id: 'n1', item_type: 'note' as const, title: '', content: 'Sul primo comma.', position: 1, status: 'unread' as const, created_at: '',
    about_item_id: 'a1', created_by: { clientName: 'Claude Code' }, assistant_notes: null,
    assistant_note: { state: 'proposed' as const, state_changed_at: null, review_comment: null, original_text: 'Sul primo comma.', edited: false, edited_at: null, edited_by: null },
    ...over,
  });
  const note = () => appStore.getState().dossiers[0].items[1] as Extract<Dossier['items'][number], { type: 'note' }>;

  it('its state from the server\'s answer, and the light of the article it is about', async () => {
    vi.mocked(assistantService.setNoteEntryState).mockResolvedValueOnce(noteApi({
      assistant_note: { state: 'review', state_changed_at: 'x', review_comment: 'Troppo generica.', original_text: 'Sul primo comma.', edited: false, edited_at: null, edited_by: null },
    }));
    await setNoteEntryState('d1', note(), 'review', 'Troppo generica.');
    expect(assistantService.setNoteEntryState).toHaveBeenCalledWith('d1', 'n1', 'review', 'Troppo generica.');
    expect(note().assistantNote).toMatchObject({ state: 'review', reviewComment: 'Troppo generica.' });
    expect(counts()).toEqual({ proposed: 0, validated: 0, review: 1 });
  });

  it('the pencil saves its text: the words change, the original stays, validated', async () => {
    vi.mocked(assistantService.editNoteEntryText).mockResolvedValueOnce(noteApi({
      content: 'Il mio testo.',
      assistant_note: { state: 'validated', state_changed_at: 'x', review_comment: null, original_text: 'Sul primo comma.', edited: true, edited_at: 'x', edited_by: { username: 'utente' } },
    }));
    await editNoteEntryText('d1', note(), 'Il mio testo.');
    expect(note().data).toBe('Il mio testo.');
    expect(note().assistantNote).toMatchObject({ state: 'validated', edited: true, originalText: 'Sul primo comma.' });
    expect(counts()).toEqual({ proposed: 0, validated: 1, review: 0 });
  });

  it('a refused write leaves it as it was and says why', async () => {
    vi.mocked(assistantService.setNoteEntryState).mockRejectedValueOnce(refused(409, "Questa voce non è una nota dell'IA"));
    await setNoteEntryState('d1', note(), 'validated');
    expect(note().assistantNote?.state).toBe('proposed');
    expect(lastNotification()).toMatchObject({ type: 'error', message: "Questa voce non è una nota dell'IA" });
  });
});
