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
import { notificationStore, offerShortcutUndo, resetNotifications, runShortcutUndo } from '../../components/ui/notifications/notifications';
import { forgetRemovals } from '../deferredRemovals';
import { showText } from '../textsOnScreen';
import type { HighlightCreate } from '../../types/api';
import type { Highlight } from '../../types';

const hl = (id: string, text: string, startOffset: number, color: Highlight['color'] = 'yellow', extra: Partial<Highlight> = {}): Highlight => ({
  id, normaKey: 'k', articleId: '1453', rangeSerialized: '', text, color, startOffset, ...extra,
});
const shown = () => notificationStore.getState().entries;
const said = () => notificationStore.getState().announced.polite?.message;
/** The next gesture, which takes the last one's place: what that one held is sent. */
const nextGesture = () => offerShortcutUndo({ message: 'altro gesto', undo: () => {} });
const marks = () => appStore.getState().highlights.map((h) => `${h.id}:${h.text}:${h.color}`);
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

let serverIds = 0;
// The text on screen: the shortcut undoes a gesture only then.
let hideText: () => void = () => {};
beforeEach(() => {
  serverIds = 0;
  hideText = showText('k');
  appStore.setState({ highlights: [hl('h1', 'contratto', 0), hl('h2', 'il danno ingiusto', 20, 'yellow', { note: 'nota del server' })], lastSyncError: null });
  vi.mocked(highlightService.delete).mockResolvedValue();
  vi.mocked(highlightService.update).mockImplementation(async (id, data) => ({ id, ...data }) as never);
  vi.mocked(highlightService.create).mockImplementation(async (data: HighlightCreate) => ({
    id: `s${++serverIds}`, normaKey: data.normaKey, text: data.text, color: data.color, startOffset: data.startOffset,
    endOffset: data.endOffset, note: data.note, userId: 'u', createdAt: '',
  }));
});

afterEach(() => {
  hideText();
  resetNotifications();
  forgetRemovals();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** A creation the test answers by hand. */
function heldCreate() {
  const answers: { ok: () => void; no: () => void }[] = [];
  vi.mocked(highlightService.create).mockImplementation((data: HighlightCreate) => new Promise((resolve, reject) => {
    answers.push({
      ok: () => resolve({ id: `s${++serverIds}`, normaKey: data.normaKey, text: data.text, color: data.color, startOffset: data.startOffset, endOffset: data.endOffset, userId: 'u', createdAt: '' }),
      no: () => reject({ status: 500, message: 'no' }),
    });
  }));
  return answers;
}

describe('editHighlights — one gesture of the highlighter, no notification, Ctrl+Z (⌘Z) undoes it (A4)', () => {
  const cut = () => appStore.getState().editHighlights({
    normaKey: 'k', articleId: '1453', remove: ['h2'], recolor: [],
    add: [{ text: 'il', startOffset: 20, color: 'yellow', from: 'h2' }, { text: 'ingiusto', startOffset: 29, color: 'yellow', from: 'h2' }],
    message: 'Evidenziazione rimossa',
  });

  it('a cut: the highlight held until the next gesture, its parts created at once, keeping what the server held', async () => {
    cut();
    expect(appStore.getState().highlights.map((h) => h.text)).toEqual(['contratto', 'il', 'ingiusto']);
    expect(shown()).toEqual([]);
    expect(said()).toBe('Evidenziazione rimossa');
    expect(highlightService.create).toHaveBeenCalledTimes(2);
    expect(vi.mocked(highlightService.create).mock.calls[0][0]).toMatchObject({ text: 'il', startOffset: 20, endOffset: 22, color: 'yellow', note: 'nota del server' });
    expect(highlightService.delete).not.toHaveBeenCalled();
    await flush();
    expect(marks()).toEqual(['h1:contratto:yellow', 's1:il:yellow', 's2:ingiusto:yellow']);
    nextGesture();
    expect(highlightService.delete).toHaveBeenCalledExactlyOnceWith('h2');
  });

  it('the key puts the highlight back where it was and deletes the parts, once their creation has answered', async () => {
    cut();
    // Undone while the parts are still on their way: they are deleted under the ids the server gives them.
    expect(runShortcutUndo()).toBe('Evidenziazione rimossa');
    expect(marks()).toEqual(['h1:contratto:yellow', 'h2:il danno ingiusto:yellow']);
    await flush();
    // The parts, under their server ids; never the highlight put back.
    expect(vi.mocked(highlightService.delete).mock.calls.map(([id]) => id).sort()).toEqual(['s1', 's2']);
    expect(marks()).toEqual(['h1:contratto:yellow', 'h2:il danno ingiusto:yellow']);
    expect(shown()).toEqual([]);
  });

  it('a recolouring: shown at once, sent with `PUT`; the key puts the colour back the same way', async () => {
    appStore.getState().editHighlights({ normaKey: 'k', articleId: '1453', remove: [], recolor: [{ id: 'h1', color: 'green' }], add: [], message: 'Evidenziazione cambiata in verde' });
    expect(marks()[0]).toBe('h1:contratto:green');
    await flush();
    expect(highlightService.update).toHaveBeenCalledExactlyOnceWith('h1', { color: 'green' });
    expect(said()).toBe('Evidenziazione cambiata in verde');
    expect(runShortcutUndo()).toBe('Evidenziazione cambiata in verde');
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

  it('several highlights in one gesture: all put back in their places by one press of the key', async () => {
    appStore.setState({ highlights: [hl('a', 'uno', 0), hl('b', 'due', 10, 'green'), hl('c', 'tre', 20, 'red')] });
    appStore.getState().editHighlights({ normaKey: 'k', articleId: '1453', remove: ['c', 'a'], recolor: [], add: [], message: 'Evidenziazioni rimosse' });
    expect(marks()).toEqual(['b:due:green']);
    expect(shown()).toEqual([]);
    expect(runShortcutUndo()).toBe('Evidenziazioni rimosse');
    expect(marks()).toEqual(['a:uno:yellow', 'b:due:green', 'c:tre:red']);
  });
});

describe('editHighlights — what a gesture waits for, and what it never loses (review of A4)', () => {
  const cut = () => appStore.getState().editHighlights({
    normaKey: 'k', articleId: '1453', remove: ['h2'], recolor: [],
    add: [{ text: 'il', startOffset: 20, color: 'yellow', from: 'h2' }, { text: 'ingiusto', startOffset: 29, color: 'yellow', from: 'h2' }],
    message: 'Evidenziazione rimossa',
  });

  it('the key after a colour given to a highlight still being created: the colour goes back once it is saved, by its server id', async () => {
    const answers = heldCreate();
    appStore.getState().addHighlight('k', '1453', 'danno', '', 'yellow', 23);
    const temp = appStore.getState().highlights.at(-1)!.id;
    appStore.getState().editHighlights({ normaKey: 'k', articleId: '1453', remove: [], recolor: [{ id: temp, color: 'red' }], add: [], message: 'Evidenziazione cambiata in rosso' });
    answers[0].ok();
    await flush();
    expect(marks().at(-1)).toBe('s1:danno:red');
    expect(runShortcutUndo()).toBe('Evidenziazione cambiata in rosso');
    await flush();
    expect(marks().at(-1)).toBe('s1:danno:yellow');
    expect(vi.mocked(highlightService.update).mock.calls).toEqual([['s1', { color: 'red' }], ['s1', { color: 'yellow' }]]);
  });

  it('the page going while the parts are on their way sends no removal: the highlight stays whole on the server', async () => {
    const answers = heldCreate();
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    cut();
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(highlightService.delete).not.toHaveBeenCalled();
    // The page lived on (a desktop's change of tab): once the parts are saved, the highlight is removed.
    answers.forEach((a) => a.ok());
    await flush();
    expect(highlightService.delete).toHaveBeenCalledExactlyOnceWith('h2');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a reading while the removal waits for the parts does not draw the highlight back', async () => {
    heldCreate();
    vi.mocked(highlightService.getByNormaKeyPrefix).mockResolvedValue([
      { id: 'h2', normaKey: 'k::art::1453', text: 'il danno ingiusto', color: 'yellow', startOffset: 20, endOffset: 37 } as never,
    ]);
    cut();
    nextGesture();
    await appStore.getState().loadHighlightsForArticle('k', '1453');
    expect(appStore.getState().highlights.map((h) => h.id)).not.toContain('h2');
  });

  it('a part refused takes the gesture back: the highlight back whole, the other part deleted, nothing left for the key', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const answers = heldCreate();
    cut();
    answers[0].no();
    answers[1].ok();
    await flush();
    expect(marks()).toEqual(['h1:contratto:yellow', 'h2:il danno ingiusto:yellow']);
    expect(highlightService.delete).toHaveBeenCalledExactlyOnceWith('s1');
    expect(runShortcutUndo()).toBeNull();
    expect(appStore.getState().lastSyncError?.message).toBe("Impossibile salvare l'evidenziazione. Riprova.");
  });

  it('the next gesture sends the cut\'s removal; the key then undoes the newer gesture alone (one step, as the owner asked)', async () => {
    cut();
    await flush();
    // A second gesture removes the part «ingiusto» (s2): the cut is settled, the highlight it cut removed.
    appStore.getState().editHighlights({ normaKey: 'k', articleId: '1453', remove: ['s2'], recolor: [], add: [], message: 'Evidenziazione rimossa' });
    expect(highlightService.delete).toHaveBeenCalledExactlyOnceWith('h2');
    expect(runShortcutUndo()).toBe('Evidenziazione rimossa');
    expect(marks()).toEqual(['h1:contratto:yellow', 's1:il:yellow', 's2:ingiusto:yellow']);
    expect(runShortcutUndo()).toBeNull();
    expect(highlightService.delete).toHaveBeenCalledTimes(1);
  });

  it('a highlight from the Forum taken away and put back is the same row, with its first author: nothing reached the server', () => {
    const forum = hl('f1', 'buona fede', 50, 'yellow', { sourceSuggestionId: 'sugg', originalAuthor: { id: 'autore', username: 'autore' } });
    appStore.setState({ highlights: [forum] });
    appStore.getState().editHighlights({ normaKey: 'k', articleId: '1453', remove: ['f1'], recolor: [], add: [], message: 'Evidenziazione rimossa' });
    expect(runShortcutUndo()).toBe('Evidenziazione rimossa');
    expect(appStore.getState().highlights).toEqual([forum]);
    expect(highlightService.delete).not.toHaveBeenCalled();
    expect(highlightService.create).not.toHaveBeenCalled();
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
