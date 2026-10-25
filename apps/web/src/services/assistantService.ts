import { apiClient } from './api';
import { getAccessToken } from './authService';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
import type { AiReviewState, Proposal } from '../types';
import type { DossierItemApi } from './dossierService';

/**
 * The routes of D7b's first cut (the server's contract, `GET /api/features` and the entry-scoped routes): what an
 * application proposed on a dossier entry, and what the user makes of its notes. Session only; with the feature off
 * every route but the first answers 404.
 */
const entry = (dossierId: string, itemId: string) =>
  `/dossiers/${encodeURIComponent(dossierId)}/items/${encodeURIComponent(itemId)}`;
const proposal = (dossierId: string, itemId: string, proposalId: string) =>
  `${entry(dossierId, itemId)}/proposals/${encodeURIComponent(proposalId)}`;

export const assistantService = {
  /** Whether the server has the feature on: answers in every case. */
  async features(): Promise<{ assistantPassages: boolean }> {
    const response = await apiClient.get<{ assistantPassages?: boolean }>('/features');
    return { assistantPassages: response.data?.assistantPassages === true };
  },

  async listProposals(dossierId: string, itemId: string): Promise<Proposal[]> {
    const response = await apiClient.get<{ proposals: Proposal[] }>(`${entry(dossierId, itemId)}/proposals`);
    return response.data.proposals ?? [];
  },

  /** `comment` is read with `review` only. */
  async setProposalState(dossierId: string, itemId: string, proposalId: string, state: AiReviewState, comment?: string | null): Promise<Proposal> {
    const body = comment === undefined ? { state } : { state, comment };
    const response = await apiClient.put<Proposal>(`${proposal(dossierId, itemId, proposalId)}/state`, body);
    return response.data;
  },

  async editProposalNote(dossierId: string, itemId: string, proposalId: string, text: string): Promise<Proposal> {
    const response = await apiClient.put<Proposal>(`${proposal(dossierId, itemId, proposalId)}/note`, { text });
    return response.data;
  },

  async removeProposal(dossierId: string, itemId: string, proposalId: string): Promise<void> {
    await apiClient.delete(proposal(dossierId, itemId, proposalId));
  },

  /**
   * The same removal as the page goes (`pagehide`): a `keepalive` fetch, which the browser carries out after the page
   * is gone, where an ordinary request is often cancelled. Nothing waits for its answer.
   */
  removeProposalOnExit(dossierId: string, itemId: string, proposalId: string): void {
    const token = getAccessToken();
    void fetch(`${API_BASE_URL}${proposal(dossierId, itemId, proposalId)}`, {
      method: 'DELETE',
      keepalive: true,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {});
  },

  /** A note entry an application wrote (contract §3). */
  async setNoteEntryState(dossierId: string, itemId: string, state: AiReviewState, comment?: string | null): Promise<DossierItemApi> {
    const body = comment === undefined ? { state } : { state, comment };
    const response = await apiClient.put<DossierItemApi>(`${entry(dossierId, itemId)}/state`, body);
    return response.data;
  },

  async editNoteEntryText(dossierId: string, itemId: string, text: string): Promise<DossierItemApi> {
    const response = await apiClient.put<DossierItemApi>(`${entry(dossierId, itemId)}/text`, { text });
    return response.data;
  },
};
