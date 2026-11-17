import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../services/trashService', () => ({ trashService: { purge: vi.fn(async () => {}) } }));
vi.mock('../../../services/dossierService', () => ({
  dossierService: {
    create: vi.fn(), addItem: vi.fn(), reorderItems: vi.fn(), delete: vi.fn(), updateItem: vi.fn(),
  },
}));

import { dossierService } from '../../../services/dossierService';
import { appStore } from '../../../store/useAppStore';
import { closeAllPracticesWithUndo } from './practiceUndo';
import { useSavePracticeAsDossier } from './useSavePracticeAsDossier';
import { registerUndoToastListener, type UndoToast } from '../../../hooks/useUndoableAction';
import { resetNotifications } from '../../ui/notifications/notifications';
import type { Dossier } from '../../../types';

/** LC51 c1: the Corpus's own places leave a table bound to a dossier out. */

const s = () => appStore.getState();
const DOSSIER: Dossier = {
  id: 'dos-1', title: 'Legata alla pratica', createdAt: '',
  items: [{ id: 'n', addedAt: '', type: 'norma', data: { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08', numero_articolo: '5' } }],
};

beforeEach(() => {
  appStore.setState({ practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, practiceNotice: null, commandPaletteOpen: false });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('a bound table in the Corpus', () => {
  it('«Chiudi tutte» counts and closes the Corpus practices; «Annulla» puts back those only', async () => {
    s().createPractice('Una');
    const bound = s().openDossierPractice(DOSSIER);
    s().createPractice('Due');
    let shown: UndoToast | null = null;
    const unregister = registerUndoToastListener((t) => { shown = t; });
    try {
      closeAllPracticesWithUndo();
      expect(s().practices.map((p) => p.id)).toEqual([bound]);
      await act(async () => {});
      expect(shown!.message).toBe('2 tavoli chiusi');
      await act(async () => { await shown!.onUndo(); });
      expect(s().practices.map((p) => p.label)).toEqual(['Una', 'Legata alla pratica', 'Due']);
      expect(s().activePracticeId).not.toBe(bound);
    } finally {
      unregister();
      resetNotifications();
    }
  });

  it('«Chiudi tutte» with only a bound table does nothing', () => {
    s().openDossierPractice(DOSSIER);
    const unregister = registerUndoToastListener(() => { throw new Error('no toast expected'); });
    try {
      closeAllPracticesWithUndo();
      expect(s().practices).toHaveLength(1);
    } finally {
      unregister();
      resetNotifications();
    }
  });

  it('«Salva come dossier» saves nothing of a bound table', async () => {
    const bound = s().openDossierPractice(DOSSIER);
    const { result } = renderHook(() => useSavePracticeAsDossier());
    await act(async () => { await result.current.saveAsNew(bound); });
    expect(dossierService.create).not.toHaveBeenCalled();
    expect(dossierService.addItem).not.toHaveBeenCalled();
  });

  it('the reorder by drag moves the chips the bar shows', () => {
    s().createPractice('Una');
    s().openDossierPractice(DOSSIER);
    s().createPractice('Due');
    // the bar's indices: «Due» (1) before «Una» (0)
    s().reorderPractices(1, 0);
    expect(s().practices.map((p) => p.label)).toEqual(['Due', 'Legata alla pratica', 'Una']);
  });
});
