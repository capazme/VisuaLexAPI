import { apiClient } from './api';

/**
 * The trash (MCP second round, spec §4.3): what a connected application deleted,
 * kept 30 days. The web app lists, restores and empties it. Its own deletions go
 * there too: a whole dossier (`dossierService.delete`, question 160), entries removed
 * from a dossier (`dossierService.trashItems`, question 181: one trash entry per
 * action), study cards (`studiaService.trash`) and the courses of «Percorsi» and their
 * modules (`corsiService.trash`, `trashModule`).
 */

/** `LINGO_CORSO` and `LINGO_CORSO_MODULO`: a course of «Percorsi», or a module of one never opened (courses spec §10.9). */
export type TrashKind = 'DOSSIER' | 'DOSSIER_ITEMS' | 'LINGO_CARDS' | 'LINGO_CORSO' | 'LINGO_CORSO_MODULO';

export interface TrashEntry {
  id: string;
  kind: TrashKind;
  dossierId: string | null;
  /** The dossier's name, for a dossier or its entries; a course's title; «module · course» for a module. */
  label: string;
  /** For a course, its modules. */
  itemCount: number;
  /** The study cards that went with a course or a module. */
  cardCount?: number;
  items?: { itemType: string; citation: string | null; actCitation: string | null }[];
  cards?: { istituto: string; domanda: string }[];
  clientName: string | null;
  /** False when the user moved it from the web app: no connected application is behind it. */
  byApplication: boolean;
  deletedAt: string;
  expiresAt: string;
}

export const trashService = {
  async list(): Promise<TrashEntry[]> {
    const response = await apiClient.get('/trash');
    return response.data;
  },

  /** 409 when the entry's dossier is gone and no `targetDossierId` says where to put it back. */
  async restore(id: string, targetDossierId?: string): Promise<{ dossierId: string | null }> {
    const response = await apiClient.post(`/trash/${id}/restore`, targetDossierId ? { targetDossierId } : {});
    return response.data;
  },

  async purge(id: string): Promise<void> {
    await apiClient.delete(`/trash/${id}`);
  },
};
