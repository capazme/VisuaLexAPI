import { useState, useEffect, useCallback } from 'react';
import { bookmarkService } from '../services/bookmarkService';
import type { Bookmark, BookmarkCreate, BookmarkUpdate } from '../types/api';

interface UseBookmarksReturn {
  bookmarks: Bookmark[];
  loading: boolean;
  error: string | null;
  createBookmark: (data: BookmarkCreate) => Promise<Bookmark>;
  updateBookmark: (id: string, data: BookmarkUpdate) => Promise<Bookmark>;
  deleteBookmark: (id: string) => Promise<void>;
  moveBookmark: (id: string, folderId: string | null) => Promise<Bookmark>;
  bulkDelete: (ids: string[]) => Promise<void>;
  bulkMove: (ids: string[], folderId: string | null) => Promise<void>;
  refresh: () => Promise<void>;
  getByNormaKey: (normaKey: string) => Bookmark | undefined;
  isBookmarked: (normaKey: string) => boolean;
}

export function useBookmarks(folderId?: string): UseBookmarksReturn {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch bookmarks
  const fetchBookmarks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await bookmarkService.getAll(folderId ? { folderId } : undefined);
      setBookmarks(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch bookmarks');
      console.error('Error fetching bookmarks:', err);
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  // Load on mount and when folderId changes
  useEffect(() => {
    fetchBookmarks();
  }, [fetchBookmarks]);

  // Create bookmark (optimistic update)
  const createBookmark = useCallback(async (data: BookmarkCreate): Promise<Bookmark> => {
    setError(null);
    try {
      const newBookmark = await bookmarkService.create(data);
      setBookmarks(prev => [newBookmark, ...prev]);
      return newBookmark;
    } catch (err: any) {
      setError(err.message || 'Failed to create bookmark');
      throw err;
    }
  }, []);

  // Update bookmark (optimistic update)
  const updateBookmark = useCallback(async (id: string, data: BookmarkUpdate): Promise<Bookmark> => {
    setError(null);
    // Optimistic update
    const previousBookmarks = bookmarks;
    setBookmarks(prev => prev.map(b => b.id === id ? { ...b, ...data } : b));

    try {
      const updated = await bookmarkService.update(id, data);
      setBookmarks(prev => prev.map(b => b.id === id ? updated : b));
      return updated;
    } catch (err: any) {
      // Rollback on error
      setBookmarks(previousBookmarks);
      setError(err.message || 'Failed to update bookmark');
      throw err;
    }
  }, [bookmarks]);

  // Delete bookmark (optimistic update)
  const deleteBookmark = useCallback(async (id: string): Promise<void> => {
    setError(null);
    // Optimistic update
    const previousBookmarks = bookmarks;
    setBookmarks(prev => prev.filter(b => b.id !== id));

    try {
      await bookmarkService.delete(id);
    } catch (err: any) {
      // Rollback on error
      setBookmarks(previousBookmarks);
      setError(err.message || 'Failed to delete bookmark');
      throw err;
    }
  }, [bookmarks]);

  // Move bookmark
  const moveBookmark = useCallback(async (id: string, targetFolderId: string | null): Promise<Bookmark> => {
    setError(null);
    const previousBookmarks = bookmarks;
    setBookmarks(prev => prev.map(b => b.id === id ? { ...b, folderId: targetFolderId || undefined } : b));

    try {
      const updated = await bookmarkService.move(id, targetFolderId);
      setBookmarks(prev => prev.map(b => b.id === id ? updated : b));
      return updated;
    } catch (err: any) {
      setBookmarks(previousBookmarks);
      setError(err.message || 'Failed to move bookmark');
      throw err;
    }
  }, [bookmarks]);

  // Bulk delete
  const bulkDelete = useCallback(async (ids: string[]): Promise<void> => {
    setError(null);
    const previousBookmarks = bookmarks;
    setBookmarks(prev => prev.filter(b => !ids.includes(b.id)));

    try {
      await bookmarkService.bulkDelete(ids);
    } catch (err: any) {
      setBookmarks(previousBookmarks);
      setError(err.message || 'Failed to delete bookmarks');
      throw err;
    }
  }, [bookmarks]);

  // Bulk move
  const bulkMove = useCallback(async (ids: string[], targetFolderId: string | null): Promise<void> => {
    setError(null);
    const previousBookmarks = bookmarks;
    setBookmarks(prev => prev.map(b => ids.includes(b.id) ? { ...b, folderId: targetFolderId || undefined } : b));

    try {
      await bookmarkService.bulkMove(ids, targetFolderId);
    } catch (err: any) {
      setBookmarks(previousBookmarks);
      setError(err.message || 'Failed to move bookmarks');
      throw err;
    }
  }, [bookmarks]);

  // Helpers
  const getByNormaKey = useCallback((normaKey: string) => {
    return bookmarks.find(b => b.normaKey === normaKey);
  }, [bookmarks]);

  const isBookmarked = useCallback((normaKey: string) => {
    return bookmarks.some(b => b.normaKey === normaKey);
  }, [bookmarks]);

  return {
    bookmarks,
    loading,
    error,
    createBookmark,
    updateBookmark,
    deleteBookmark,
    moveBookmark,
    bulkDelete,
    bulkMove,
    refresh: fetchBookmarks,
    getByNormaKey,
    isBookmarked,
  };
}
