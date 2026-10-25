import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/assistantService', () => ({
  assistantService: {
    features: vi.fn(), listProposals: vi.fn(), setProposalState: vi.fn(), editProposalNote: vi.fn(), removeProposal: vi.fn(),
    setNoteEntryState: vi.fn(), editNoteEntryText: vi.fn(),
  },
}));

import { assistantService } from '../../services/assistantService';
import {
  assistantProposalsStore, editNoteEntryText, editProposalNote, loadAssistantFeatures, loadProposals, removeProposal,
  setNoteEntryState, setProposalState,
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
const notFound = (detail: string) => Object.assign(new Error('404'), { response: { status: 404, data: { detail } } });
const lastNotification = () => notificationStore.getState().entries.at(-1)!;

beforeEach(() => {
  vi.mocked(assistantService.features).mockResolvedValue({ assistantPassages: true });
  vi.mocked(assistantService.listProposals).mockResolvedValue([p1, p2]);
  vi.mocked(assistantService.removeProposal).mockResolvedValue();
  assistantProposalsStore.setState({ enabled: false, byItem: {} });
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

  it('switched off since: a «Non disponibile» 404 hides every proposal; another 404 does not', async () => {
    await loadAssistantFeatures();
    await loadProposals('d1', 'a1');
    vi.mocked(assistantService.listProposals).mockRejectedValueOnce(notFound('Voce non trovata'));
    await loadProposals('d1', 'other');
    expect(assistantProposalsStore.getState().enabled).toBe(true);
    vi.mocked(assistantService.listProposals).mockRejectedValueOnce(notFound('Non disponibile'));
    await loadProposals('d1', 'a1');
    expect(assistantProposalsStore.getState()).toEqual({ enabled: false, byItem: {} });
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

  it('a refused write changes nothing and says why', async () => {
    vi.mocked(assistantService.setProposalState).mockRejectedValueOnce(Object.assign(new Error('409'), { response: { status: 409, data: { detail: 'Questo passaggio non ha una nota' } } }));
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
    vi.mocked(assistantService.removeProposal).mockRejectedValueOnce(notFound('Proposta non trovata'));
    removeProposal('d1', 'a1', 'p1');
    closeNotification(lastNotification().id, 'dismiss');
    await vi.waitFor(() => expect(assistantProposalsStore.getState().byItem.a1.map((p) => p.id)).toEqual(['p1', 'p2']));
    expect(lastNotification()).toMatchObject({ type: 'error', message: 'Proposta non trovata' });
  });

  it('the page going sends it at once, and only once', () => {
    removeProposal('d1', 'a1', 'p1');
    window.dispatchEvent(new Event('pagehide'));
    expect(assistantService.removeProposal).toHaveBeenCalledTimes(1);
    closeNotification(lastNotification().id, 'timeout');
    expect(assistantService.removeProposal).toHaveBeenCalledTimes(1);
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
    vi.mocked(assistantService.setNoteEntryState).mockRejectedValueOnce(Object.assign(new Error('409'), { response: { status: 409, data: { detail: "Questa voce non è una nota dell'IA" } } }));
    await setNoteEntryState('d1', note(), 'validated');
    expect(note().assistantNote?.state).toBe('proposed');
    expect(lastNotification()).toMatchObject({ type: 'error', message: "Questa voce non è una nota dell'IA" });
  });
});
