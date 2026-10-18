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

export type AdminEnvironmentListParams = {
  page?: number;
  limit?: number;
  status?: 'active' | 'withdrawn' | 'all';
  search?: string;
};

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

// ============================================
// VisuaLex Studia: the texts users accept
// ============================================

/** What the administrator writes for one version of a text; the number and the author come from the server. */
export interface StudiaTextBody {
  titolo: string;
  corpo: string;
  /** The checkbox's label. */
  conferma: string;
  /** The button's label. */
  azione: string;
}

export interface StudiaTextVersion extends StudiaTextBody {
  id: string;
  versione: number;
  createdAt: string;
  /** The administrator's username; null when the version was written by a migration or the account is gone. */
  autore: string | null;
}

export interface StudiaTextGroup {
  chiave: string;
  /** Newest first: the first is the current version. */
  versioni: StudiaTextVersion[];
}

/**
 * Every text with all its versions, newest first.
 */
export const studiaTexts = async (): Promise<StudiaTextGroup[]> => {
  const response = await get<{ testi: StudiaTextGroup[] }>('/admin/studia/testi');
  return response.testi;
};

/**
 * Save a new version of a text (never overwrites). Rejects with status 409 when another version
 * was saved at the same moment.
 */
export const saveStudiaText = async (chiave: string, body: StudiaTextBody): Promise<StudiaTextVersion> => {
  return post<StudiaTextVersion>(`/admin/studia/testi/${encodeURIComponent(chiave)}`, body);
};

// ============================================
// VisuaLex Studia: the thresholds of the community's validation
// ============================================

/** The two numbers: approvals needed to validate a proposed card, «errata» votes needed to archive it. */
export interface StudiaSoglie {
  approvazioni: number;
  errate: number;
}

export interface StudiaSoglieSettings {
  soglie: StudiaSoglie;
  limiti: { approvazioni: { min: number; max: number }; errate: { min: number; max: number } };
  predefinite: StudiaSoglie;
}

/** What a change would do (or did): how many proposed cards become validated and archived. */
export interface StudiaSoglieEffetto {
  validate: number;
  archiviate: number;
}

export const studiaSoglie = async (): Promise<StudiaSoglieSettings> => {
  return get<StudiaSoglieSettings>('/admin/studia/soglie');
};

/** Read-only: the counts the thresholds would give now. */
export const previewStudiaSoglie = async (soglie: StudiaSoglie): Promise<StudiaSoglieEffetto> => {
  return post<StudiaSoglieEffetto>('/admin/studia/soglie/anteprima', soglie);
};

/** Saves both values and recomputes the proposed cards; answers the values and the counts applied. */
export const saveStudiaSoglie = async (soglie: StudiaSoglie): Promise<StudiaSoglieEffetto & { soglie: StudiaSoglie }> => {
  return put<StudiaSoglieEffetto & { soglie: StudiaSoglie }>('/admin/studia/soglie', soglie);
};
