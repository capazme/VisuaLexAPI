import { appStore } from '../../../store/useAppStore';
import type { Dossier, SearchParams } from '../../../types';
import { searchesForGroups, type NormaGroup } from './dossierUtils';

/**
 * A dossier opened on the practices' table (spec §5.1, gotcha 15): exactly ONE practice, named after
 * the dossier and made active, created here, synchronously, before the caller navigates; every
 * search targets it (`searchesForGroups` with `() => practiceId`), the past groups landing as rows of
 * their acts (D15). `withDecisions` (every group opened: the picker's «Apri tutto», or a dossier of
 * one group) also puts the dossier's decisions under «Giurisprudenza», in one write, closed and
 * unread (no row, no window, so nothing is fetched until one is opened, T17), and identified with
 * what the dossier kept (section, type, date of deposit), so «Salva come dossier» saves them back.
 */
export function searchesIntoOnePractice(dossier: Dossier, groups: NormaGroup[], withDecisions: boolean): SearchParams[] {
  const { createPractice, addKnownDecisions } = appStore.getState();
  const practiceId = createPractice(dossier.title, { custom: true, activate: true });
  if (withDecisions) {
    addKnownDecisions(practiceId, dossier.items.flatMap((item) => (item.type === 'sentenza' ? [item.data] : [])));
  }
  return searchesForGroups(dossier.title, groups, () => practiceId);
}
