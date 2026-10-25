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
    expect(fetchMock).toHaveBeenCalledWith('/api/highlights/h2', expect.objectContaining({
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

  it('a refused removal puts it back with its words', async () => {
    vi.mocked(annotationService.delete).mockRejectedValueOnce(refused(500));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    appStore.getState().removeAnnotation('n1');
    closeNotification(last().id, 'timeout');
    await vi.waitFor(() => expect(appStore.getState().annotations.map((a) => a.id)).toEqual(['n1', 'n2']));
    expect(appStore.getState().lastSyncError?.message).toBe('Impossibile eliminare la nota. Riprova.');
  });
});
