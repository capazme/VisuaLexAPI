import { apiClient } from '../../services/api';

/** A pending authorization request, as the server shows it to the consent page. */
export interface AuthorizationRequestView {
  id: string;
  client: { name: string | null; redirectHost: string; registeredAutomatically: boolean };
  scopes: { scope: string; label: string }[];
  expiresAt: string;
}

/** An application the user connected (an OAuth grant). */
export interface ConnectedApp {
  id: string;
  clientName: string | null;
  redirectHost: string | null;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export const connectionsService = {
  async getRequest(requestId: string): Promise<AuthorizationRequestView> {
    const response = await apiClient.get(`/oauth/requests/${encodeURIComponent(requestId)}`);
    return response.data;
  },
  async decide(requestId: string, approve: boolean): Promise<{ redirectTo: string }> {
    const response = await apiClient.post(`/oauth/requests/${encodeURIComponent(requestId)}/decision`, { approve });
    return response.data;
  },
  async listConnectedApps(): Promise<ConnectedApp[]> {
    const response = await apiClient.get('/oauth/grants');
    return response.data;
  },
  async revoke(grantId: string): Promise<void> {
    await apiClient.delete(`/oauth/grants/${encodeURIComponent(grantId)}`);
  },
};
