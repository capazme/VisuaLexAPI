import { apiClient } from '../../services/api';

/** A pending authorization request, as the server shows it to the consent page. */
export interface AuthorizationRequestView {
  id: string;
  client: { name: string | null; redirectHost: string; registeredAutomatically: boolean };
  scopes: { scope: string; label: string }[];
  /** The permission to delete, offered apart and unticked (MCP second round). */
  deletion?: { label: string; /** The connection already may delete: the box starts ticked, so a reconnect keeps it. */ granted?: boolean };
  expiresAt: string;
}

/** An application the user connected (an OAuth grant). */
export interface ConnectedApp {
  id: string;
  clientName: string | null;
  redirectHost: string | null;
  scopes: string[];
  /** Whether this connection may delete (into the trash, after the user's confirmation). */
  canDelete: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export const connectionsService = {
  async getRequest(requestId: string): Promise<AuthorizationRequestView> {
    const response = await apiClient.get(`/oauth/requests/${encodeURIComponent(requestId)}`);
    return response.data;
  },
  async decide(requestId: string, approve: boolean, allowDelete = false): Promise<{ redirectTo: string }> {
    const response = await apiClient.post(`/oauth/requests/${encodeURIComponent(requestId)}/decision`, { approve, allowDelete });
    return response.data;
  },
  async listConnectedApps(): Promise<ConnectedApp[]> {
    const response = await apiClient.get('/oauth/grants');
    return response.data;
  },
  async setCanDelete(grantId: string, canDelete: boolean): Promise<void> {
    await apiClient.patch(`/oauth/grants/${encodeURIComponent(grantId)}`, { canDelete });
  },
  async revoke(grantId: string): Promise<void> {
    await apiClient.delete(`/oauth/grants/${encodeURIComponent(grantId)}`);
  },
};
