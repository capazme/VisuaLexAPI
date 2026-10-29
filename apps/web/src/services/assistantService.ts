import { apiClient, getFreshAccessToken } from './api';
import { getAccessToken } from './authService';
import type { AiReviewState, Proposal } from '../types';
import type { DossierItemApi } from './dossierService';

// As `apiClient`'s base: the exit's removal is a plain `fetch`.
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const entry = (dossierId: string, itemId: string) =>
  `/dossiers/${encodeURIComponent(dossierId)}/items/${encodeURIComponent(itemId)}`;
const proposal = (dossierId: string, itemId: string, proposalId: string) =>
  `${entry(dossierId, itemId)}/proposals/${encodeURIComponent(proposalId)}`;

/**
 * The routes of D7b's first cut (the server's contract): `GET /api/features`, public and cached by the server for a few
 * seconds, and the entry-scoped routes, the session's only, of what an application proposed on a dossier entry and of
 * what the user makes of its notes. With the feature off every route but the first answers 404 «Non disponibile».
 */
export const assistantService = {
  /**
   * Whether the server has the features on: answers in every case. `lingoCourses` is Gymnasium's «Percorsi» (spec
   * 2026-10-23 §10.10), read here so that the app asks once.
   */
  async features(): Promise<{ assistantPassages: boolean; lingoCourses: boolean }> {
    const response = await apiClient.get<{ assistantPassages?: boolean; lingoCourses?: boolean }>('/features');
    return { assistantPassages: response.data?.assistantPassages === true, lingoCourses: response.data?.lingoCourses === true };
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

  /**
   * The passage's new boundaries, from the user's selection (contract §2.3): its offset in the reader's projection and
   * the projection's slice there, 1–2000 characters. The application's own boundaries stay on the server; the note's
   * state does not change.
   */
  async moveProposal(dossierId: string, itemId: string, proposalId: string, startOffset: number, text: string): Promise<Proposal> {
    const response = await apiClient.put<Proposal>(`${proposal(dossierId, itemId, proposalId)}/range`, { startOffset, text });
    return response.data;
  },

  async removeProposal(dossierId: string, itemId: string, proposalId: string): Promise<void> {
    await apiClient.delete(proposal(dossierId, itemId, proposalId));
  },

  /**
   * The same removal as the page goes (`pagehide`): a `keepalive` fetch, which the browser carries out after the page
   * is gone, where an ordinary request is often cancelled. Nothing waits for its answer.
   */
  /** Refreshes the session's token now if it is about to expire: the exit's removal cannot refresh it. */
  async refreshForExit(): Promise<void> {
    await getFreshAccessToken().catch(() => null);
  },

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
