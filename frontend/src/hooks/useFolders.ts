/**
 * Custom hook for folder management with backend integration
 */
import { useState, useEffect, useCallback } from 'react';
import * as folderService from '../services/folderService';
import type { FolderTree, FolderResponse, FolderCreate, FolderUpdate } from '../types/api';

interface FoldersState {
  folders: FolderResponse[];
  tree: FolderTree[];
  loading: boolean;
  error: string | null;
}

export function useFolders() {
  const [state, setState] = useState<FoldersState>({
    folders: [],
    tree: [],
    loading: false,
    error: null,
  });

  /**
   * Load folder tree from backend
   */
  const loadTree = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const tree = await folderService.getFolderTree();
      setState((prev) => ({
        ...prev,
        tree,
        loading: false,
      }));
      return tree;
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error.message || 'Failed to load folders',
      }));
      throw error;
    }
  }, []);

  /**
   * Load all folders (flat list)
   */
  const loadFolders = useCallback(async (parentId?: string) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const folders = await folderService.getFolders({ parent_id: parentId });
      setState((prev) => ({
        ...prev,
        folders,
        loading: false,
      }));
      return folders;
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error.message || 'Failed to load folders',
      }));
      throw error;
    }
  }, []);

  /**
   * Create a new folder
   */
  const createFolder = useCallback(
    async (data: FolderCreate) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const newFolder = await folderService.createFolder(data);

        // Reload tree to reflect changes
        await loadTree();

        setState((prev) => ({ ...prev, loading: false }));
        return newFolder;
      } catch (error: any) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error.message || 'Failed to create folder',
        }));
        throw error;
      }
    },
    [loadTree]
  );

  /**
   * Update a folder
   */
  const updateFolder = useCallback(
    async (folderId: string, data: FolderUpdate) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const updated = await folderService.updateFolder(folderId, data);

        // Reload tree to reflect changes
        await loadTree();

        setState((prev) => ({ ...prev, loading: false }));
        return updated;
      } catch (error: any) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error.message || 'Failed to update folder',
        }));
        throw error;
      }
    },
    [loadTree]
  );

  /**
   * Move a folder to a new parent
   */
  const moveFolder = useCallback(
    async (folderId: string, parentId: string | undefined, position = 0) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const moved = await folderService.moveFolder(folderId, {
          parent_id: parentId,
          position,
        });

        // Reload tree to reflect changes
        await loadTree();

        setState((prev) => ({ ...prev, loading: false }));
        return moved;
      } catch (error: any) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error.message || 'Failed to move folder',
        }));
        throw error;
      }
    },
    [loadTree]
  );

  /**
   * Delete a folder
   */
  const deleteFolder = useCallback(
    async (folderId: string) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        await folderService.deleteFolder(folderId);

        // Reload tree to reflect changes
        await loadTree();

        setState((prev) => ({ ...prev, loading: false }));
      } catch (error: any) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error.message || 'Failed to delete folder',
        }));
        throw error;
      }
    },
    [loadTree]
  );

  /**
   * Bulk delete folders
   */
  const bulkDeleteFolders = useCallback(
    async (folderIds: string[]) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        await folderService.bulkDeleteFolders({ folder_ids: folderIds });

        // Reload tree to reflect changes
        await loadTree();

        setState((prev) => ({ ...prev, loading: false }));
      } catch (error: any) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error.message || 'Failed to delete folders',
        }));
        throw error;
      }
    },
    [loadTree]
  );

  /**
   * Bulk move folders
   */
  const bulkMoveFolders = useCallback(
    async (folderIds: string[], targetParentId?: string) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        await folderService.bulkMoveFolders({
          folder_ids: folderIds,
          target_parent_id: targetParentId,
        });

        // Reload tree to reflect changes
        await loadTree();

        setState((prev) => ({ ...prev, loading: false }));
      } catch (error: any) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error.message || 'Failed to move folders',
        }));
        throw error;
      }
    },
    [loadTree]
  );

  /**
   * Clear error
   */
  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  /**
   * Load tree on mount
   */
  useEffect(() => {
    loadTree();
  }, [loadTree]);

  return {
    ...state,
    loadTree,
    loadFolders,
    createFolder,
    updateFolder,
    moveFolder,
    deleteFolder,
    bulkDeleteFolders,
    bulkMoveFolders,
    clearError,
  };
}
