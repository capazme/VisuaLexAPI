import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/highlightService', () => ({
  highlightService: { delete: vi.fn(), getByNormaKeyPrefix: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  getFreshAccessToken: vi.fn(async () => 'fresh'),
}));
vi.mock('../../services/authService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/authService')>()),
  isAuthenticated: () => true,
  getAccessToken: () => 'token-1',
}));

import { appStore } from '../useAppStore';
import { highlightService } from '../../services/highlightService';
import { closeNotification, notificationStore, resetNotifications, undoNotification } from '../../components/ui/notifications/notifications';
import type { HighlightCreate } from '../../types/api';
import type { Highlight } from '../../types';

const hl = (id: string, text: string, startOffset: number, color: Highlight['color'] = 'yellow', extra: Partial<Highlight> = {}): Highlight => ({
  id, normaKey: 'k', articleId: '1453', rangeSerialized: '', text, color, startOffset, ...extra,
});
const shown = () => notificationStore.getState().entries;
const last = () => shown().at(-1)!;
const marks = () => appStore.getState().highlights.map((h) => `${h.id}:${h.text}:${h.color}`);
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

let serverIds = 0;
beforeEach(() => {
  serverIds = 0;
  appStore.setState({ highlights: [hl('h1', 'contratto', 0), hl('h2', 'il danno ingiusto', 20, 'yellow', { note: 'nota del server' })], lastSyncError: null });
  vi.mocked(highlightService.delete).mockResolvedValue();
  vi.mocked(highlightService.update).mockImplementation(async (id, data) => ({ id, ...data }) as never);
  vi.mocked(highlightService.create).mockImplementation(async (data: HighlightCreate) => ({
    id: `s${++serverIds}`, normaKey: data.normaKey, text: data.text, color: data.color, startOffset: data.startOffset,
    endOffset: data.endOffset, note: data.note, userId: 'u', createdAt: '',
  }));
});

afterEach(() => {
  resetNotifications();
  vi.clearAllMocks();
});

describe('editHighlights — one gesture of the highlighter, one «Annulla» (A4)', () => {
  const cut = () => appStore.getState().editHighlights({
    normaKey: 'k', articleId: '1453', remove: ['h2'], recolor: [],
    add: [{ text: 'il', startOffset: 20, color: 'yellow', from: 'h2' }, { text: 'ingiusto', startOffset: 29, color: 'yellow', from: 'h2' }],
    message: 'Evidenziazione rimossa',
  });

  it('a cut: the highlight goes behind «Annulla», its parts are created at once, keeping what the server held', async () => {
    cut();
    expect(appStore.getState().highlights.map((h) => h.text)).toEqual(['contratto', 'il', 'ingiusto']);
    expect(shown().filter((e) => e.undoable)).toHaveLength(1);
    expect(last()).toMatchObject({ message: 'Evidenziazione rimossa', undoable: true });
    expect(highlightService.create).toHaveBeenCalledTimes(2);
    expect(vi.mocked(highlightService.create).mock.calls[0][0]).toMatchObject({ text: 'il', startOffset: 20, endOffset: 22, color: 'yellow', note: 'nota del server' });
    expect(highlightService.delete).not.toHaveBeenCalled();
    await flush();
    expect(marks()).toEqual(['h1:contratto:yellow', 's1:il:yellow', 's2:ingiusto:yellow']);
    closeNotification(last().id, 'timeout');
    expect(highlightService.delete).toHaveBeenCalledExactlyOnceWith('h2');
  });

  it('«Annulla» puts the highlight back where it was and deletes the parts, once their creation has answered', async () => {
    cut();
    // Undone while the parts are still on their way: they are deleted under the ids the server gives them.
    await undoNotification(last().id);
    expect(marks()).toEqual(['h1:contratto:yellow', 'h2:il danno ingiusto:yellow']);
    await flush();
    // The parts, under their server ids; never the highlight put back.
    expect(vi.mocked(highlightService.delete).mock.calls.map(([id]) => id).sort()).toEqual(['s1', 's2']);
    expect(marks()).toEqual(['h1:contratto:yellow', 'h2:il danno ingiusto:yellow']);
    expect(shown().some((e) => e.message === 'Ripristinato')).toBe(true);
  });

  it('a recolouring: shown at once, sent with `PUT`; «Annulla» puts the colour back the same way', async () => {
    appStore.getState().editHighlights({ normaKey: 'k', articleId: '1453', remove: [], recolor: [{ id: 'h1', color: 'green' }], add: [], message: 'Evidenziazione cambiata in verde' });
    expect(marks()[0]).toBe('h1:contratto:green');
    await flush();
    expect(highlightService.update).toHaveBeenCalledExactlyOnceWith('h1', { color: 'green' });
    expect(last()).toMatchObject({ message: 'Evidenziazione cambiata in verde', undoable: true });
    await undoNotification(last().id);
    expect(marks()[0]).toBe('h1:contratto:yellow');
    await flush();
    expect(vi.mocked(highlightService.update).mock.calls.at(-1)).toEqual(['h1', { color: 'yellow' }]);
  });

  it('a colour given to a highlight still being created waits for its id, and the server\'s answer does not undo it', async () => {
    appStore.getState().addHighlight('k', '1453', 'danno', '', 'yellow', 23);
    const temp = appStore.getState().highlights.at(-1)!.id;
    appStore.getState().editHighlights({ normaKey: 'k', articleId: '1453', remove: [], recolor: [{ id: temp, color: 'red' }], add: [], message: 'Evidenziazione cambiata in rosso' });
    expect(highlightService.update).not.toHaveBeenCalled();
    await flush();
    expect(highlightService.update).toHaveBeenCalledExactlyOnceWith('s1', { color: 'red' });
    expect(marks().at(-1)).toBe('s1:danno:red');
  });

  it('a colour refused goes back, and says so', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(highlightService.update).mockRejectedValueOnce({ status: 500, message: 'no' });
    appStore.getState().editHighlights({ normaKey: 'k', articleId: '1453', remove: [], recolor: [{ id: 'h1', color: 'blue' }], add: [], message: 'Evidenziazione cambiata in blu' });
    await flush();
    expect(marks()[0]).toBe('h1:contratto:yellow');
    expect(appStore.getState().lastSyncError?.message).toBe("Impossibile cambiare il colore dell'evidenziazione. Riprova.");
  });

  it('several highlights in one gesture: one notification, all put back in their places by «Annulla»', async () => {
    appStore.setState({ highlights: [hl('a', 'uno', 0), hl('b', 'due', 10, 'green'), hl('c', 'tre', 20, 'red')] });
    appStore.getState().editHighlights({ normaKey: 'k', articleId: '1453', remove: ['c', 'a'], recolor: [], add: [], message: 'Evidenziazioni rimosse' });
    expect(marks()).toEqual(['b:due:green']);
    expect(shown().filter((e) => e.undoable)).toHaveLength(1);
    await undoNotification(last().id);
    expect(marks()).toEqual(['a:uno:yellow', 'b:due:green', 'c:tre:red']);
  });
});

describe('the highlighter\'s state (A4)', () => {
  afterEach(() => appStore.setState((s) => ({ readingTool: null, highlighterEraser: false, settings: { ...s.settings, highlightColor: 'yellow' } })));

  it('«Nessun colore» is the session\'s; a colour chosen is saved as the colour of new highlights (H1) and clears it', () => {
    appStore.getState().setHighlighterInk('green');
    expect(appStore.getState().settings.highlightColor).toBe('green');
    appStore.getState().setHighlighterInk('none');
    expect(appStore.getState()).toMatchObject({ highlighterEraser: true, settings: { highlightColor: 'green' } });
    appStore.getState().setHighlighterInk('red');
    expect(appStore.getState()).toMatchObject({ highlighterEraser: false, settings: { highlightColor: 'red' } });
  });

  it('is never saved, and the next person on the browser never finds the tool on', () => {
    appStore.getState().setReadingTool('highlight');
    appStore.getState().setHighlighterInk('none');
    const saved = JSON.stringify(appStore.persist.getOptions().partialize?.(appStore.getState()));
    expect(saved).not.toContain('readingTool');
    expect(saved).not.toContain('highlighterEraser');
    appStore.getState().clearUserData();
    expect(appStore.getState()).toMatchObject({ readingTool: null, highlighterEraser: false });
  });
});
