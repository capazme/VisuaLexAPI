/**
 * Folder service for hierarchical folder management
 */
import { get, post, put, patch, del } from './api';
import type {
  FolderCreate,
  FolderUpdate,
  FolderMove,
  FolderResponse,
  FolderTree,
  FolderBulkDelete,
  FolderBulkMove,
} from '../types/api';

/**
 * Create a new folder
 */
export const createFolder = async (data: FolderCreate): Promise<FolderResponse> => {
  return post<FolderResponse>('/folders/', data);
};

/**
 * Get all folders for current user
 */
export const getFolders = async (params?: {
  include_children?: boolean;
  parent_id?: string;
}): Promise<FolderResponse[]> => {
  return get<FolderResponse[]>('/folders/', params);
};

/**
 * Get complete folder tree with nested structure
 */
export const getFolderTree = async (): Promise<FolderTree[]> => {
  return get<FolderTree[]>('/folders/tree');
};

/**
 * Get a specific folder by ID
 */
export const getFolder = async (
  folderId: string,
  includeChildren = false
): Promise<FolderResponse> => {
  return get<FolderResponse>(`/folders/${folderId}`, {
    include_children: includeChildren,
  });
};

/**
 * Update a folder
 */
export const updateFolder = async (
  folderId: string,
  data: FolderUpdate
): Promise<FolderResponse> => {
  return put<FolderResponse>(`/folders/${folderId}`, data);
};

/**
 * Move a folder to a new parent and/or position
 */
export const moveFolder = async (
  folderId: string,
  data: FolderMove
): Promise<FolderResponse> => {
  return patch<FolderResponse>(`/folders/${folderId}/move`, data);
};

/**
 * Delete a folder and all its contents
 */
export const deleteFolder = async (folderId: string): Promise<void> => {
  return del<void>(`/folders/${folderId}`);
};

/**
 * Delete multiple folders at once
 */
export const bulkDeleteFolders = async (data: FolderBulkDelete): Promise<void> => {
  return post<void>('/folders/bulk/delete', data);
};

/**
 * Move multiple folders to a new parent
 */
export const bulkMoveFolders = async (data: FolderBulkMove): Promise<FolderResponse[]> => {
  return post<FolderResponse[]>('/folders/bulk/move', data);
};
