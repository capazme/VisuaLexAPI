import { appStore } from '../../../store/useAppStore';
import type { Dossier, SearchParams } from '../../../types';
import { identityOf } from '../../../utils/decisionLinks';
import { searchesForGroups, type NormaGroup } from './dossierUtils';

/**
 * A dossier opened on the practices' table (spec §5.1, gotcha 15): exactly ONE practice, named after
 * the dossier and made active, created here, synchronously, before the caller navigates; every
 * search targets it (`searchesForGroups` with `() => practiceId`), the past groups landing as rows of
 * their acts (D15). `withDecisions` (every group opened: the picker's «Apri tutto», or a dossier of
 * one group) also puts the dossier's decisions under «Giurisprudenza», closed and unread
 * (`open: false`: no row, no window, so nothing is fetched until one is opened, T17).
 */
export function searchesIntoOnePractice(dossier: Dossier, groups: NormaGroup[], withDecisions: boolean): SearchParams[] {
  const { createPractice, openDecision } = appStore.getState();
  const practiceId = createPractice(dossier.title, { custom: true, activate: true });
  if (withDecisions) {
    for (const item of dossier.items) {
      if (item.type !== 'sentenza') continue;
      const { sezione } = item.data;
      openDecision({ ...identityOf(item.data), ...(sezione ? { sezione } : {}) }, { practiceId, open: false });
    }
  }
  return searchesForGroups(dossier.title, groups, () => practiceId);
}
