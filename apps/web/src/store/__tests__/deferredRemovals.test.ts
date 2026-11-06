import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/highlightService', () => ({
  highlightService: { delete: vi.fn(), getByNormaKeyPrefix: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock('../../services/annotationService', () => ({
  annotationService: { delete: vi.fn(), getByNormaKeyPrefix: vi.fn(), create: vi.fn(), update: vi.fn() },
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
import { getFreshAccessToken } from '../../services/api';
import { forgetRemovals, holdGesture, isRemovalPending, removeAtOnce, removeManyWithUndo, savingDone, savingStarted } from '../deferredRemovals';
import { showText } from '../textsOnScreen';
import { highlightService } from '../../services/highlightService';
import { annotationService } from '../../services/annotationService';
import {
  closeNotification,
  notificationStore,
  offerShortcutUndo,
  resetNotifications,
  runShortcutUndo,
  settleShortcutUndo,
  undoNotification,
} from '../../components/ui/notifications/notifications';
import type { Annotation, Highlight } from '../../types';

const hl = (id: string): Highlight => ({ id, normaKey: 'k', articleId: '1453', rangeSerialized: '', text: 'contraenti', color: 'yellow', startOffset: 30 });
const note = (id: string): Annotation => ({ id, normaKey: 'k', articleId: '1453', text: 'Mia nota', createdAt: '', anchorText: 'contraenti', startOffset: 30 });
const ids = () => appStore.getState().highlights.map((h) => h.id);
const shown = () => notificationStore.getState().entries;
const last = () => shown().at(-1)!;
const refused = (status: number) => ({ status, message: 'no', data: { detail: 'no' } });
/** The next gesture, which takes the last one's place: what that one held is sent. */
const nextGesture = () => offerShortcutUndo({ message: 'altro gesto', undo: () => {} });
const said = () => notificationStore.getState().announced.polite?.message;

// The text the highlights are on, on screen: the shortcut undoes a gesture only then.
let hideText: () => void = () => {};
beforeEach(() => {
  appStore.setState({ highlights: [hl('h1'), hl('h2'), hl('h3')], annotations: [note('n1'), note('n2')], lastSyncError: null, loadedHighlightKeys: {} });
  vi.mocked(highlightService.delete).mockResolvedValue();
  vi.mocked(annotationService.delete).mockResolvedValue();
  hideText = showText('k');
});

afterEach(() => {
  hideText();
  resetNotifications();
  // A gesture's removal held with no notification is forgotten too, or the next test's page would send it.
  forgetRemovals();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('removing a highlight (A4, 5 November): no notification, held until the next gesture, Ctrl+Z (⌘Z) undoes it', () => {
  it('goes off the screen at once with nothing shown, said to a screen reader; the server hears of it as the next gesture comes', () => {
    appStore.getState().removeHighlight('h2');
    expect(ids()).toEqual(['h1', 'h3']);
    expect(shown()).toEqual([]);
    expect(said()).toBe('Evidenziazione rimossa');
    expect(highlightService.delete).not.toHaveBeenCalled();
    nextGesture();
    expect(highlightService.delete).toHaveBeenCalledExactlyOnceWith('h2');
    // Its undo went with it.
    expect(runShortcutUndo()).not.toBe('Evidenziazione rimossa');
  });

  it('the key puts it back where it was and sends nothing, long after five seconds', () => {
    vi.useFakeTimers();
    appStore.getState().removeHighlight('h2');
    vi.advanceTimersByTime(10 * 60_000);
    expect(highlightService.delete).not.toHaveBeenCalled();
    expect(runShortcutUndo()).toBe('Evidenziazione rimossa');
    expect(ids()).toEqual(['h1', 'h2', 'h3']);
    expect(isRemovalPending('highlight:h2')).toBe(false);
    nextGesture();
    expect(highlightService.delete).not.toHaveBeenCalled();
    // Once: a second press finds nothing.
    expect(runShortcutUndo()).toBe('altro gesto');
    expect(runShortcutUndo()).toBeNull();
  });

  it('not while its text is off screen: the key goes by, and the gesture waits for the text to come back', () => {
    appStore.getState().removeHighlight('h2');
    hideText();
    expect(runShortcutUndo()).toBeNull();
    expect(ids()).toEqual(['h1', 'h3']);
    hideText = showText('k');
    expect(runShortcutUndo()).toBe('Evidenziazione rimossa');
    expect(ids()).toEqual(['h1', 'h2', 'h3']);
  });

  it('a refused removal puts it back and says so; one the server no longer has is simply gone', async () => {
    vi.mocked(highlightService.delete).mockRejectedValueOnce(refused(500));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    appStore.getState().removeHighlight('h2');
    nextGesture();
    await vi.waitFor(() => expect(ids()).toEqual(['h1', 'h2', 'h3']));
    expect(appStore.getState().lastSyncError?.message).toBe("Impossibile eliminare l'evidenziazione. Riprova.");

    appStore.setState({ lastSyncError: null });
    vi.mocked(highlightService.delete).mockRejectedValueOnce(refused(404));
    appStore.getState().removeHighlight('h3');
    nextGesture();
    await Promise.resolve();
    await Promise.resolve();
    expect(ids()).toEqual(['h1', 'h2']);
    expect(appStore.getState().lastSyncError).toBeNull();
  });

  it('as the page goes it is sent at once, by a keepalive fetch with the token, and the key no longer undoes it', () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    appStore.getState().removeHighlight('h2');
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/highlights\/h2$/), expect.objectContaining({
      method: 'DELETE', keepalive: true, headers: { Authorization: 'Bearer token-1' },
    }));
    expect(runShortcutUndo()).toBeNull();
    expect(highlightService.delete).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a keepalive refused for a token run out, the page alive: sent again by the client, which refreshes it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    appStore.getState().removeHighlight('h2');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await vi.waitFor(() => expect(highlightService.delete).toHaveBeenCalledExactlyOnceWith('h2'));
  });

  it('a reading while it waits does not draw it back', async () => {
    vi.mocked(highlightService.getByNormaKeyPrefix).mockResolvedValue([
      { id: 'h2', normaKey: 'k::art::1453', text: 'contraenti', color: 'yellow', startOffset: 30, endOffset: 40 } as never,
    ]);
    appStore.setState({ highlights: [hl('h2')] });
    appStore.getState().removeHighlight('h2');
    await appStore.getState().loadHighlightsForArticle('k', '1453');
    expect(ids()).toEqual([]);
  });

  it('a DELETE refused after a logout puts nothing back in the emptied store, and says nothing', async () => {
    let refuse: (e: unknown) => void = () => {};
    vi.mocked(highlightService.delete).mockReturnValueOnce(new Promise<void>((_, reject) => { refuse = reject; }));
    appStore.getState().removeHighlight('h2');
    nextGesture();
    appStore.getState().clearUserData();
    refuse(refused(500));
    await new Promise((r) => setTimeout(r, 0));
    expect(ids()).toEqual([]);
    expect(appStore.getState().lastSyncError).toBeNull();
  });

  it('at logout it is sent first, while the token is there (`settleShortcutUndo`); what the emptied store held is forgotten', () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    appStore.getState().removeHighlight('h2');
    settleShortcutUndo();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\/highlights\/h2$/), expect.objectContaining({
      method: 'DELETE', keepalive: true, headers: { Authorization: 'Bearer token-1' },
    }));
    appStore.getState().removeHighlight('h3');
    // The store emptied without it (a session that ended unannounced): nothing more is sent.
    appStore.getState().clearUserData();
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(highlightService.delete).not.toHaveBeenCalled();
  });
});

describe('removing a highlight: the edges', () => {
  it('as the tab is hidden (a phone may discard it unannounced) it is sent at once, as at pagehide', () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    appStore.getState().removeHighlight('h2');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/highlights\/h2$/), expect.objectContaining({ method: 'DELETE', keepalive: true }));
  });

  it('a reading while its DELETE is out does not draw it back', async () => {
    let answer: () => void = () => {};
    vi.mocked(highlightService.delete).mockReturnValueOnce(new Promise<void>((resolve) => { answer = resolve; }));
    vi.mocked(highlightService.getByNormaKeyPrefix).mockResolvedValue([
      { id: 'h2', normaKey: 'k::art::1453', text: 'contraenti', color: 'yellow', startOffset: 30, endOffset: 40 } as never,
    ]);
    appStore.setState({ highlights: [hl('h2')] });
    appStore.getState().removeHighlight('h2');
    nextGesture();
    await appStore.getState().loadHighlightsForArticle('k', '1453');
    expect(ids()).toEqual([]);
    answer();
  });

  describe('made and removed before the server answered', () => {
    const created = (id: string) => ({ id, normaKey: 'k::art::1453', text: 'contraenti', color: 'yellow', startOffset: 30, endOffset: 40 }) as never;

    it('is removed under the id the server gives it, once it answers', async () => {
      let answer: (r: never) => void = () => {};
      vi.mocked(highlightService.create).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
      appStore.setState({ highlights: [] });
      appStore.getState().addHighlight('k', '1453', 'contraenti', '', 'yellow', 30);
      const temp = ids()[0];
      appStore.getState().removeHighlight(temp);
      nextGesture();
      expect(highlightService.delete).not.toHaveBeenCalled();
      answer(created('srv-1'));
      await vi.waitFor(() => expect(highlightService.delete).toHaveBeenCalledWith('srv-1'));
      expect(ids()).toEqual([]);
    });

    it('sent by the tab being hidden (a change of tab, the page alive), it is still removed once the server answers', async () => {
      let answer: (r: never) => void = () => {};
      vi.mocked(highlightService.create).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
      appStore.setState({ highlights: [] });
      appStore.getState().addHighlight('k', '1453', 'contraenti', '', 'yellow', 30);
      appStore.getState().removeHighlight(ids()[0]);
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      expect(highlightService.delete).not.toHaveBeenCalled();
      answer(created('srv-3'));
      await vi.waitFor(() => expect(highlightService.delete).toHaveBeenCalledWith('srv-3'));
      expect(ids()).toEqual([]);
    });

    it('the key after the answer puts back the saved one, under its server id', async () => {
      let answer: (r: never) => void = () => {};
      vi.mocked(highlightService.create).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
      appStore.setState({ highlights: [] });
      appStore.getState().addHighlight('k', '1453', 'contraenti', '', 'yellow', 30);
      appStore.getState().removeHighlight(ids()[0]);
      answer(created('srv-2'));
      await Promise.resolve();
      await Promise.resolve();
      expect(runShortcutUndo()).toBe('Evidenziazione rimossa');
      expect(ids()).toEqual(['srv-2']);
      expect(highlightService.delete).not.toHaveBeenCalled();
    });

    it('whose creation failed: nothing is sent, and the key brings back no ghost', async () => {
      let refuse: (e: unknown) => void = () => {};
      vi.mocked(highlightService.create).mockReturnValueOnce(new Promise((_, reject) => { refuse = reject; }));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      appStore.setState({ highlights: [] });
      appStore.getState().addHighlight('k', '1453', 'contraenti', '', 'yellow', 30);
      appStore.getState().removeHighlight(ids()[0]);
      refuse(refused(500));
      await vi.waitFor(() => expect(appStore.getState().lastSyncError).not.toBeNull());
      // Nothing to take back: the key says nothing and goes on (to an «Annulla» on screen, if any).
      expect(runShortcutUndo()).toBeNull();
      expect(ids()).toEqual([]);
      nextGesture();
      expect(highlightService.delete).not.toHaveBeenCalled();
    });
  });
});

describe('a new highlight is a gesture too (A4, 5 November)', () => {
  it('said to a screen reader and nothing shown; the key takes it off the screen and deletes it once saved', async () => {
    let answer: (r: never) => void = () => {};
    vi.mocked(highlightService.create).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    appStore.setState({ highlights: [] });
    appStore.getState().addHighlight('k', '1453', 'contraenti', '', 'green', 30);
    expect(shown()).toEqual([]);
    expect(said()).toBe('Testo evidenziato in verde');
    expect(runShortcutUndo()).toBe('Testo evidenziato in verde');
    expect(ids()).toEqual([]);
    expect(highlightService.delete).not.toHaveBeenCalled();
    answer({ id: 'srv-9', normaKey: 'k::art::1453', text: 'contraenti', color: 'green', startOffset: 30, endOffset: 40 } as never);
    await vi.waitFor(() => expect(highlightService.delete).toHaveBeenCalledExactlyOnceWith('srv-9'));
    expect(ids()).toEqual([]);
  });

  it('one whose creation failed leaves the key nothing to undo: it says nothing and goes on', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(highlightService.create).mockRejectedValueOnce(refused(500));
    appStore.setState({ highlights: [] });
    appStore.getState().addHighlight('k', '1453', 'contraenti', '', 'green', 30);
    await vi.waitFor(() => expect(appStore.getState().lastSyncError).not.toBeNull());
    expect(runShortcutUndo()).toBeNull();
    expect(highlightService.delete).not.toHaveBeenCalled();
  });
});

describe('removing a note, behind «Annulla»', () => {
  it('goes at once, «Nota rimossa», and only the closing notification sends it', () => {
    appStore.getState().removeAnnotation('n1');
    expect(appStore.getState().annotations.map((a) => a.id)).toEqual(['n2']);
    expect(last()).toMatchObject({ message: 'Nota rimossa', undoable: true });
    expect(annotationService.delete).not.toHaveBeenCalled();
    closeNotification(last().id, 'timeout');
    expect(annotationService.delete).toHaveBeenCalledWith('n1');
  });

  it('«Annulla» puts it back first in line, as it was', async () => {
    appStore.getState().removeAnnotation('n1');
    await undoNotification(last().id);
    expect(appStore.getState().annotations.map((a) => a.id)).toEqual(['n1', 'n2']);
    expect(annotationService.delete).not.toHaveBeenCalled();
  });

  it('a reading while it waits does not draw it back', async () => {
    vi.mocked(annotationService.getByNormaKeyPrefix).mockResolvedValue([
      { id: 'n1', normaKey: 'k::art::1453', content: 'Mia nota', createdAt: '', textContext: 'contraenti', position: 30 } as never,
    ]);
    appStore.setState({ annotations: [note('n1')], loadedAnnotationKeys: {} } as never);
    appStore.getState().removeAnnotation('n1');
    await appStore.getState().loadAnnotationsForArticle('k', '1453');
    expect(appStore.getState().annotations).toEqual([]);
  });

  it('a refused removal puts it back with its words', async () => {
    vi.mocked(annotationService.delete).mockRejectedValueOnce(refused(500));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    appStore.getState().removeAnnotation('n1');
    closeNotification(last().id, 'timeout');
    await vi.waitFor(() => expect(appStore.getState().annotations.map((a) => a.id)).toEqual(['n1', 'n2']));
    expect(appStore.getState().lastSyncError?.message).toBe('Impossibile eliminare la nota. Riprova.');
  });
});


describe('several removals behind one «Annulla» (A4)', () => {
  const target = (id: string, remove = vi.fn(async () => {})) => ({ key: `x:${id}`, path: `/x/${id}`, remove, item: id });

  it('one notification; as it closes each is removed, and as the page goes each by a keepalive fetch', () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const putBack = vi.fn();
    const a = target('a');
    const b = target('b');
    removeManyWithUndo({ message: 'Evidenziazioni rimosse', targets: [a, b], putBack, onRefused: vi.fn() });
    expect(shown().filter((e) => e.undoable)).toHaveLength(1);
    expect(isRemovalPending('x:a') && isRemovalPending('x:b')).toBe(true);
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([expect.stringMatching(/\/x\/a$/), expect.stringMatching(/\/x\/b$/)]);
    expect(a.remove).not.toHaveBeenCalled();
    expect(putBack).not.toHaveBeenCalled();
  });

  it('«Annulla» puts every item back, then runs what came with them', async () => {
    const putBack = vi.fn();
    const onUndo = vi.fn();
    removeManyWithUndo({ message: 'Evidenziazioni rimosse', targets: [target('a'), target('b')], putBack, onRefused: vi.fn(), onUndo });
    await undoNotification(last().id);
    expect(putBack.mock.calls).toEqual([['a'], ['b']]);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(isRemovalPending('x:a')).toBe(false);
  });

  it('one still being created is removed under the id the server gives it', async () => {
    savingStarted('x:temp');
    const saved = target('server');
    removeManyWithUndo({ message: 'Evidenziazioni rimosse', targets: [target('a'), target('temp')], putBack: vi.fn(), onRefused: vi.fn() });
    savingDone('x:temp', saved);
    closeNotification(last().id, 'timeout');
    expect(saved.remove).toHaveBeenCalledTimes(1);
  });

  it('dropped at logout: nothing is sent, now or as the page goes', () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const a = target('a');
    removeManyWithUndo({ message: 'Evidenziazioni rimosse', targets: [a], putBack: vi.fn(), onRefused: vi.fn() });
    resetNotifications();
    forgetRemovals();
    window.dispatchEvent(new Event('pagehide'));
    expect(a.remove).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('removeAtOnce: sent now, or once a creation still out answers; refused, put back', async () => {
    const refused = target('r', vi.fn(async () => { throw { status: 500 }; }));
    const putBack = vi.fn();
    const onRefused = vi.fn();
    removeAtOnce(refused, putBack, onRefused);
    await vi.waitFor(() => expect(putBack).toHaveBeenCalledWith('r'));
    expect(onRefused).toHaveBeenCalledTimes(1);
    savingStarted('x:later');
    const server = target('server');
    removeAtOnce(target('later'), vi.fn(), vi.fn());
    expect(server.remove).not.toHaveBeenCalled();
    savingDone('x:later', server);
    expect(server.remove).toHaveBeenCalledTimes(1);
  });
});

describe('holdGesture: a gesture held for the key alone (A4)', () => {
  const target = (id: string, remove = vi.fn(async () => {})) => ({ key: `y:${id}`, path: `/y/${id}`, remove, item: id });

  it('shows nothing; the next gesture sends what it held, and its own key undoes only the newer', () => {
    const a = target('a');
    const putBack = vi.fn();
    holdGesture({ message: 'Evidenziazioni rimosse', onScreen: () => true, targets: [a], putBack, onRefused: vi.fn() });
    expect(shown()).toEqual([]);
    expect(isRemovalPending('y:a')).toBe(true);
    const b = target('b');
    holdGesture({ message: 'Evidenziazione rimossa', onScreen: () => true, targets: [b], putBack, onRefused: vi.fn() });
    expect(a.remove).toHaveBeenCalledTimes(1);
    expect(runShortcutUndo()).toBe('Evidenziazione rimossa');
    expect(putBack.mock.calls).toEqual([['b']]);
    expect(b.remove).not.toHaveBeenCalled();
  });

  it('keeps the token fresh while its removals wait, and stops once they are sent or taken back', async () => {
    vi.useFakeTimers();
    vi.mocked(getFreshAccessToken).mockClear();
    holdGesture({ message: 'Evidenziazione rimossa', onScreen: () => true, targets: [target('a')], putBack: vi.fn(), onRefused: vi.fn() });
    vi.mocked(getFreshAccessToken).mockClear();
    vi.advanceTimersByTime(60_000);
    expect(getFreshAccessToken).toHaveBeenCalledExactlyOnceWith(120);
    runShortcutUndo();
    vi.advanceTimersByTime(5 * 60_000);
    expect(getFreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('keeps the token fresh for a removal moved meanwhile to the id the server gave its highlight', () => {
    vi.useFakeTimers();
    savingStarted('y:temp');
    holdGesture({ message: 'Evidenziazione rimossa', onScreen: () => true, targets: [target('temp')], putBack: vi.fn(), onRefused: vi.fn() });
    savingDone('y:temp', target('server'));
    vi.mocked(getFreshAccessToken).mockClear();
    vi.advanceTimersByTime(3 * 60_000);
    expect(getFreshAccessToken).toHaveBeenCalledTimes(3);
  });

  it('a part refused takes the gesture back at once, and the key with it', async () => {
    let answer: (ok: boolean) => void = () => {};
    const ready = new Promise<boolean>((resolve) => { answer = resolve; });
    const putBack = vi.fn();
    const onUndo = vi.fn();
    holdGesture({ message: 'Evidenziazione rimossa', onScreen: () => true, targets: [target('a')], putBack, onRefused: vi.fn(), onUndo, ready });
    answer(false);
    await vi.waitFor(() => expect(putBack).toHaveBeenCalledWith('a'));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(runShortcutUndo()).toBeNull();
  });
});
