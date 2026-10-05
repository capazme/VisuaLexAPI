import { apiClient } from './api';

/**
 * The trash (MCP second round, spec §4.3): what a connected application deleted,
 * kept 30 days. The web app lists, restores and empties it; it never moves
 * anything there (its own deletions stay immediate, with an undo).
 */

export type TrashKind = 'DOSSIER' | 'DOSSIER_ITEMS' | 'LINGO_CARDS';

export interface TrashEntry {
  id: string;
  kind: TrashKind;
  dossierId: string | null;
  /** The dossier's name, for a dossier or its entries. */
  label: string;
  itemCount: number;
  items?: { itemType: string; citation: string | null; actCitation: string | null }[];
  cards?: { istituto: string; domanda: string }[];
  clientName: string | null;
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
