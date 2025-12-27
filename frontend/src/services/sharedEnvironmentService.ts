import { apiClient } from './api';
import type {
  SharedEnvironment,
  SharedEnvironmentListResponse,
  PublishEnvironmentPayload,
  SharedEnvironmentContent,
  EnvironmentCategory,
  ReportReason,
  SharedEnvironmentReport,
} from '../types';

export interface ListSharedEnvironmentsParams {
  page?: number;
  limit?: number;
  category?: EnvironmentCategory | 'all';
  tags?: string;
  sort?: 'newest' | 'popular' | 'mostDownloaded';
  search?: string;
}

export interface ToggleLikeResponse {
  liked: boolean;
  likeCount: number;
}

export interface DownloadResponse {
  content: SharedEnvironmentContent;
  includeNotes: boolean;
  includeHighlights: boolean;
}

export const sharedEnvironmentService = {
  /**
   * List shared environments with filtering and pagination
   */
  async list(params: ListSharedEnvironmentsParams = {}): Promise<SharedEnvironmentListResponse> {
    const response = await apiClient.get('/shared-environments', { params });
    return response.data;
  },

  /**
   * Get environments published by the current user
   */
  async getMyShared(): Promise<SharedEnvironment[]> {
    const response = await apiClient.get('/shared-environments/my');
    return response.data;
  },

  /**
   * Get single shared environment by ID
   */
  async getById(id: string): Promise<SharedEnvironment> {
    const response = await apiClient.get(`/shared-environments/${id}`);
    return response.data;
  },

  /**
   * Publish a new shared environment
   */
  async publish(data: PublishEnvironmentPayload): Promise<SharedEnvironment> {
    const response = await apiClient.post('/shared-environments', data);
    return response.data;
  },

  /**
   * Update a shared environment (owner only)
   */
  async update(
    id: string,
    data: Partial<Omit<PublishEnvironmentPayload, 'content'>>
  ): Promise<SharedEnvironment> {
    const response = await apiClient.put(`/shared-environments/${id}`, data);
    return response.data;
  },

  /**
   * Delete a shared environment (owner only)
   */
  async delete(id: string): Promise<void> {
    await apiClient.delete(`/shared-environments/${id}`);
  },

  /**
   * Toggle like on a shared environment
   */
  async toggleLike(id: string): Promise<ToggleLikeResponse> {
    const response = await apiClient.post(`/shared-environments/${id}/like`);
    return response.data;
  },

  /**
   * Download/import a shared environment
   * Records the download and returns the content
   */
  async download(id: string): Promise<DownloadResponse> {
    const response = await apiClient.post(`/shared-environments/${id}/download`);
    return response.data;
  },

  /**
   * Report a shared environment
   */
  async report(id: string, reason: ReportReason, details?: string): Promise<void> {
    await apiClient.post(`/shared-environments/${id}/report`, { reason, details });
  },

  // ============================================
  // ADMIN ENDPOINTS
  // ============================================

  /**
   * Get all reports (admin only)
   */
  async getReports(status?: 'pending' | 'reviewed' | 'dismissed' | 'all'): Promise<SharedEnvironmentReport[]> {
    const response = await apiClient.get('/admin/shared-environment-reports', {
      params: status ? { status } : undefined,
    });
    return response.data;
  },

  /**
   * Update report status (admin only)
   */
  async updateReportStatus(
    reportId: string,
    status: 'pending' | 'reviewed' | 'dismissed'
  ): Promise<{ id: string; status: string }> {
    const response = await apiClient.put(`/admin/shared-environment-reports/${reportId}`, { status });
    return response.data;
  },

  /**
   * Admin delete shared environment
   */
  async adminDelete(id: string): Promise<void> {
    await apiClient.delete(`/admin/shared-environments/${id}`);
  },
};
