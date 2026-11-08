import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';

vi.mock('../../services/annotationService', () => ({
  annotationService: { delete: vi.fn(), getByNormaKeyPrefix: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock('../../services/highlightService', () => ({
  highlightService: { delete: vi.fn(), getByNormaKeyPrefix: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  getFreshAccessToken: vi.fn(async () => 'fresh'),
}));

import { appStore } from '../useAppStore';
import { forgetRemovals } from '../deferredRemovals';
import { showText } from '../textsOnScreen';
import { annotationService } from '../../services/annotationService';
import { highlightService } from '../../services/highlightService';
import { NotificationHost } from '../../components/ui/notifications/NotificationHost';
import { resetNotifications } from '../../components/ui/notifications/notifications';
import type { Annotation, Highlight } from '../../types';

// The owner's third correction after the test of #410 (5 November 2026): a note keeps its notification with «Annulla»
// for five seconds, and Ctrl+Z (⌘Z on a Mac) is its shortcut (L-36); a highlight's gesture, which says nothing, shares
// the key, the newer first.

const note: Annotation = { id: 'n1', normaKey: 'k', articleId: '1453', text: 'Mia nota', createdAt: '', anchorText: 'contraenti', startOffset: 30 };
const mark: Highlight = { id: 'h1', normaKey: 'k', articleId: '1453', rangeSerialized: '', text: 'contraenti', color: 'yellow', startOffset: 30 };
const press = () => act(async () => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
});

let hideText: () => void = () => {};
beforeEach(() => {
  Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'Win32' });
  appStore.setState({ annotations: [note], highlights: [mark], lastSyncError: null });
  vi.mocked(annotationService.delete).mockResolvedValue();
  vi.mocked(highlightService.delete).mockResolvedValue();
  hideText = showText('k');
});

afterEach(() => {
  hideText();
  resetNotifications();
  forgetRemovals();
  Reflect.deleteProperty(navigator, 'platform');
  vi.clearAllMocks();
});

describe('a note removed: its notification and its shortcut (A4, point 3)', () => {
  it('keeps «Nota rimossa» with «Annulla · Ctrl+Z», and the key puts the note back, sending nothing', async () => {
    render(<NotificationHost />);
    await act(async () => { appStore.getState().removeAnnotation('n1'); });
    const card = screen.getByRole('listitem');
    expect(card).toHaveTextContent('Nota rimossa');
    expect(within(card).getByRole('button', { name: 'Annulla' })).toHaveTextContent('Ctrl+Z');
    await press();
    expect(appStore.getState().annotations.map((a) => a.id)).toEqual(['n1']);
    expect(annotationService.delete).not.toHaveBeenCalled();
  });

  it('with a highlight taken away after it, the key undoes the highlight first, then the note', async () => {
    render(<NotificationHost />);
    await act(async () => { appStore.getState().removeAnnotation('n1'); });
    await act(async () => { appStore.getState().removeHighlight('h1'); });
    // Only the note's notification: the highlight said nothing.
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    await press();
    expect(appStore.getState().highlights.map((h) => h.id)).toEqual(['h1']);
    expect(appStore.getState().annotations).toEqual([]);
    await press();
    expect(appStore.getState().annotations.map((a) => a.id)).toEqual(['n1']);
    expect(highlightService.delete).not.toHaveBeenCalled();
    expect(annotationService.delete).not.toHaveBeenCalled();
  });
});
