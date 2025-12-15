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
