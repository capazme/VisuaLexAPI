/**
 * Admin service for user management
 */
import { get, post, put, del } from './api';
import type { AdminUserCreate, AdminUserUpdate, AdminUserResponse, AdminResetPassword } from '../types/api';

/**
 * Get all users
 */
export const listUsers = async (): Promise<AdminUserResponse[]> => {
  return get<AdminUserResponse[]>('/admin/users');
};

/**
 * Get user by ID
 */
export const getUser = async (id: string): Promise<AdminUserResponse> => {
  return get<AdminUserResponse>(`/admin/users/${id}`);
};

/**
 * Create new user
 */
export const createUser = async (data: AdminUserCreate): Promise<AdminUserResponse> => {
  return post<AdminUserResponse>('/admin/users', data);
};

/**
 * Update user
 */
export const updateUser = async (id: string, data: AdminUserUpdate): Promise<AdminUserResponse> => {
  return put<AdminUserResponse>(`/admin/users/${id}`, data);
};

/**
 * Delete user
 */
export const deleteUser = async (id: string): Promise<void> => {
  return del(`/admin/users/${id}`);
};

/**
 * Reset user password
 */
export const resetPassword = async (id: string, data: AdminResetPassword): Promise<{ message: string }> => {
  return post<{ message: string }>(`/admin/users/${id}/reset-password`, data);
};

// ============================================
// Feedback Management
// ============================================

export type FeedbackType = 'bug' | 'suggestion' | 'other';
export type FeedbackStatus = 'new' | 'read' | 'resolved' | 'dismissed';

export interface AdminFeedback {
  id: string;
  type: FeedbackType;
  message: string;
  status: FeedbackStatus;
  user_id: string;
  created_at: string;
  user: {
    id: string;
    email: string;
    username: string;
  };
}

export interface FeedbackStats {
  total: number;
  new: number;
  bugs: number;
  suggestions: number;
}

/**
 * Get all feedbacks
 */
export const listFeedbacks = async (params?: { status?: FeedbackStatus; type?: FeedbackType }): Promise<AdminFeedback[]> => {
  return get<AdminFeedback[]>('/admin/feedbacks', params);
};

/**
 * Get feedback statistics
 */
export const getFeedbackStats = async (): Promise<FeedbackStats> => {
  return get<FeedbackStats>('/admin/feedbacks/stats');
};

/**
 * Update feedback status
 */
export const updateFeedbackStatus = async (id: string, status: FeedbackStatus): Promise<AdminFeedback> => {
  return put<AdminFeedback>(`/admin/feedbacks/${id}`, { status });
};

/**
 * Delete feedback
 */
export const deleteFeedback = async (id: string): Promise<void> => {
  return del(`/admin/feedbacks/${id}`);
};

// ============================================
// Shared Environments Management (Admin)
// ============================================

export interface AdminSharedEnvironment {
  id: string;
  title: string;
  description?: string;
  category: string;
  tags: string[];
  currentVersion: number;
  isActive: boolean;
  viewCount: number;
  downloadCount: number;
  likeCount: number;
  versionCount: number;
  suggestionsCount: number;
  user: {
    id: string;
    username: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AdminEnvironmentListResponse {
  data: AdminSharedEnvironment[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface AdminEnvironmentListParams {
  page?: number;
  limit?: number;
  status?: 'active' | 'withdrawn' | 'all';
  search?: string;
}

/**
 * Get all shared environments (admin)
 */
export const listSharedEnvironments = async (params?: AdminEnvironmentListParams): Promise<AdminEnvironmentListResponse> => {
  return get<AdminEnvironmentListResponse>('/admin/shared-environments', params);
};

/**
 * Withdraw shared environment (admin)
 */
export const withdrawSharedEnvironment = async (id: string): Promise<{ id: string; isActive: boolean }> => {
  return post<{ id: string; isActive: boolean }>(`/admin/shared-environments/${id}/withdraw`);
};

/**
 * Republish shared environment (admin)
 */
export const republishSharedEnvironment = async (id: string): Promise<{ id: string; isActive: boolean }> => {
  return post<{ id: string; isActive: boolean }>(`/admin/shared-environments/${id}/republish`);
};

/**
 * Delete shared environment (admin)
 */
export const deleteSharedEnvironment = async (id: string): Promise<void> => {
  return del(`/admin/shared-environments/${id}`);
};
