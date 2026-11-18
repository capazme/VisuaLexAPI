import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/annotationService', () => ({
  annotationService: { delete: vi.fn(), getByNormaKeyPrefix: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

import { appStore } from '../useAppStore';
import { annotationService } from '../../services/annotationService';
import type { AnnotationResponse } from '../../types/api';

/** The server's answer to a field over its length (#598), as `services/api.ts` rejects it. */
const tooLong = { status: 400, message: 'Campo «nota»: al massimo 50.000 caratteri.', data: { detail: 'Campo «nota»: al massimo 50.000 caratteri.', error: 'too_long' } };
const notes = () => appStore.getState().annotations;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  appStore.setState({ annotations: [], lastSyncError: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('a note the server refuses as too long (400 «too_long», #598)', () => {
  it('keeps the note and its text, and says the server\'s words, not «Impossibile salvare la nota»', async () => {
    vi.mocked(annotationService.create).mockRejectedValueOnce(tooLong);
    appStore.getState().addAnnotation('k', '1453', 'Una nota molto lunga', { anchorText: 'contraenti', startOffset: 30 });
    await settle();
    expect(notes().map((n) => n.text)).toEqual(['Una nota molto lunga']);
    expect(appStore.getState().lastSyncError?.message).toBe('Campo «nota»: al massimo 50.000 caratteri.');
  });

  it('sends it again, shortened, as a new note when it is edited', async () => {
    vi.mocked(annotationService.create)
      .mockRejectedValueOnce(tooLong)
      .mockResolvedValueOnce({ id: 'srv-1', normaKey: 'k', content: 'Più corta', textContext: 'contraenti', position: 30, createdAt: '2026-11-18T10:00:00Z' } as unknown as AnnotationResponse);
    appStore.getState().addAnnotation('k', '1453', 'Una nota molto lunga', { anchorText: 'contraenti', startOffset: 30 });
    await settle();
    appStore.getState().updateAnnotation(notes()[0].id, 'Più corta');
    await settle();
    expect(annotationService.update).not.toHaveBeenCalled();
    expect(vi.mocked(annotationService.create).mock.calls[1][0]).toMatchObject({ content: 'Più corta', textContext: 'contraenti' });
    expect(notes().map((n) => [n.id, n.text])).toEqual([['srv-1', 'Più corta']]);
  });

  it('keeps an edit of a saved note on screen with the server\'s words', async () => {
    appStore.setState({ annotations: [{ id: 'n1', normaKey: 'k', articleId: '1453', text: 'Breve', createdAt: '' }] });
    vi.mocked(annotationService.update).mockRejectedValueOnce(tooLong);
    appStore.getState().updateAnnotation('n1', 'Molto più lunga');
    await settle();
    expect(notes()[0].text).toBe('Molto più lunga');
    expect(appStore.getState().lastSyncError?.message).toBe('Campo «nota»: al massimo 50.000 caratteri.');
  });

  it('still takes the note back on any other failure', async () => {
    vi.mocked(annotationService.create).mockRejectedValueOnce({ status: 503, message: 'no', data: { detail: 'no' } });
    appStore.getState().addAnnotation('k', '1453', 'Nota');
    await settle();
    expect(notes()).toEqual([]);
    expect(appStore.getState().lastSyncError?.message).toBe('Impossibile salvare la nota. Riprova.');
  });
});
