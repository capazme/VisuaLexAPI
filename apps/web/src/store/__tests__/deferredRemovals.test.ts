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
import { highlightService } from '../../services/highlightService';
import { annotationService } from '../../services/annotationService';
import { closeNotification, notificationStore, resetNotifications, undoNotification } from '../../components/ui/notifications/notifications';
import type { Annotation, Highlight } from '../../types';

const hl = (id: string): Highlight => ({ id, normaKey: 'k', articleId: '1453', rangeSerialized: '', text: 'contraenti', color: 'yellow', startOffset: 30 });
const note = (id: string): Annotation => ({ id, normaKey: 'k', articleId: '1453', text: 'Mia nota', createdAt: '', anchorText: 'contraenti', startOffset: 30 });
const ids = () => appStore.getState().highlights.map((h) => h.id);
const shown = () => notificationStore.getState().entries;
const last = () => shown().at(-1)!;
const refused = (status: number) => ({ status, message: 'no', data: { detail: 'no' } });

beforeEach(() => {
  appStore.setState({ highlights: [hl('h1'), hl('h2'), hl('h3')], annotations: [note('n1'), note('n2')], lastSyncError: null, loadedHighlightKeys: {} });
  vi.mocked(highlightService.delete).mockResolvedValue();
  vi.mocked(annotationService.delete).mockResolvedValue();
});

afterEach(() => {
  resetNotifications();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('removing a highlight, behind «Annulla»', () => {
  it('goes off the screen at once; the server hears of it only as the notification closes', () => {
    appStore.getState().removeHighlight('h2');
    expect(ids()).toEqual(['h1', 'h3']);
    expect(last()).toMatchObject({ message: 'Evidenziazione rimossa', undoable: true });
    expect(highlightService.delete).not.toHaveBeenCalled();
    closeNotification(last().id, 'timeout');
    expect(highlightService.delete).toHaveBeenCalledWith('h2');
  });

  it('«Annulla» puts it back where it was, sends nothing, and says «Ripristinato»', async () => {
    appStore.getState().removeHighlight('h2');
    await undoNotification(last().id);
    expect(ids()).toEqual(['h1', 'h2', 'h3']);
    expect(highlightService.delete).not.toHaveBeenCalled();
    expect(shown().some((e) => e.message === 'Ripristinato')).toBe(true);
  });

  it('a refused removal puts it back and says so; one the server no longer has is simply gone', async () => {
    vi.mocked(highlightService.delete).mockRejectedValueOnce(refused(500));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    appStore.getState().removeHighlight('h2');
    closeNotification(last().id, 'dismiss');
    await vi.waitFor(() => expect(ids()).toEqual(['h1', 'h2', 'h3']));
    expect(appStore.getState().lastSyncError?.message).toBe("Impossibile eliminare l'evidenziazione. Riprova.");

    appStore.setState({ lastSyncError: null });
    vi.mocked(highlightService.delete).mockRejectedValueOnce(refused(404));
    appStore.getState().removeHighlight('h3');
    closeNotification(last().id, 'timeout');
    await Promise.resolve();
    await Promise.resolve();
    expect(ids()).toEqual(['h1', 'h2']);
    expect(appStore.getState().lastSyncError).toBeNull();
  });

  it('as the page goes it is sent at once, by a keepalive fetch with the token, and its «Annulla» goes', () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    appStore.getState().removeHighlight('h2');
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/highlights\/h2$/), expect.objectContaining({
      method: 'DELETE', keepalive: true, headers: { Authorization: 'Bearer token-1' },
    }));
    expect(shown().some((e) => e.message === 'Evidenziazione rimossa')).toBe(false);
    expect(highlightService.delete).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    closeNotification(last().id, 'timeout');
    appStore.getState().clearUserData();
    refuse(refused(500));
    await new Promise((r) => setTimeout(r, 0));
    expect(ids()).toEqual([]);
    expect(appStore.getState().lastSyncError).toBeNull();
  });

  it('at logout nothing is sent, now or as the page goes', () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    appStore.getState().removeHighlight('h2');
    appStore.getState().clearUserData();
    window.dispatchEvent(new Event('pagehide'));
    expect(highlightService.delete).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
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
    closeNotification(last().id, 'timeout');
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
      closeNotification(last().id, 'timeout');
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

    it('«Annulla» after the answer puts back the saved one, under its server id', async () => {
      let answer: (r: never) => void = () => {};
      vi.mocked(highlightService.create).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
      appStore.setState({ highlights: [] });
      appStore.getState().addHighlight('k', '1453', 'contraenti', '', 'yellow', 30);
      appStore.getState().removeHighlight(ids()[0]);
      answer(created('srv-2'));
      await Promise.resolve();
      await Promise.resolve();
      await undoNotification(last().id);
      expect(ids()).toEqual(['srv-2']);
      expect(highlightService.delete).not.toHaveBeenCalled();
    });

    it('whose creation failed: nothing is sent, and «Annulla» brings back no ghost', async () => {
      let refuse: (e: unknown) => void = () => {};
      vi.mocked(highlightService.create).mockReturnValueOnce(new Promise((_, reject) => { refuse = reject; }));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      appStore.setState({ highlights: [] });
      appStore.getState().addHighlight('k', '1453', 'contraenti', '', 'yellow', 30);
      appStore.getState().removeHighlight(ids()[0]);
      const removal = last().id;
      refuse(refused(500));
      await vi.waitFor(() => expect(appStore.getState().lastSyncError).not.toBeNull());
      await undoNotification(removal);
      expect(ids()).toEqual([]);
      closeNotification(removal, 'timeout');
      expect(highlightService.delete).not.toHaveBeenCalled();
    });
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
