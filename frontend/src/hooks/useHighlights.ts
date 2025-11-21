import { useState, useEffect, useCallback } from 'react';
import { highlightService } from '../services/highlightService';
import type { Highlight, HighlightCreate, HighlightUpdate } from '../types/api';

interface UseHighlightsReturn {
  highlights: Highlight[];
  loading: boolean;
  error: string | null;
  createHighlight: (data: HighlightCreate) => Promise<Highlight>;
  updateHighlight: (id: string, data: HighlightUpdate) => Promise<Highlight>;
  deleteHighlight: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  getById: (id: string) => Highlight | undefined;
}

export function useHighlights(normaKey: string | null): UseHighlightsReturn {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch highlights for specific article
  const fetchHighlights = useCallback(async () => {
    if (!normaKey) {
      setHighlights([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await highlightService.getByNormaKey(normaKey);
      setHighlights(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch highlights');
      console.error('Error fetching highlights:', err);
    } finally {
      setLoading(false);
    }
  }, [normaKey]);

  // Load on mount and when normaKey changes
  useEffect(() => {
    fetchHighlights();
  }, [fetchHighlights]);

  // Create highlight (optimistic update)
  const createHighlight = useCallback(async (data: HighlightCreate): Promise<Highlight> => {
    setError(null);
    try {
      const newHighlight = await highlightService.create(data);
      setHighlights(prev => [...prev, newHighlight]);
      return newHighlight;
    } catch (err: any) {
      setError(err.message || 'Failed to create highlight');
      throw err;
    }
  }, []);

  // Update highlight (optimistic update)
  const updateHighlight = useCallback(async (id: string, data: HighlightUpdate): Promise<Highlight> => {
    setError(null);
    const previousHighlights = highlights;
    setHighlights(prev => prev.map(h => h.id === id ? { ...h, ...data } : h));

    try {
      const updated = await highlightService.update(id, data);
      setHighlights(prev => prev.map(h => h.id === id ? updated : h));
      return updated;
    } catch (err: any) {
      setHighlights(previousHighlights);
      setError(err.message || 'Failed to update highlight');
      throw err;
    }
  }, [highlights]);

  // Delete highlight (optimistic update)
  const deleteHighlight = useCallback(async (id: string): Promise<void> => {
    setError(null);
    const previousHighlights = highlights;
    setHighlights(prev => prev.filter(h => h.id !== id));

    try {
      await highlightService.delete(id);
    } catch (err: any) {
      setHighlights(previousHighlights);
      setError(err.message || 'Failed to delete highlight');
      throw err;
    }
  }, [highlights]);

  // Helper
  const getById = useCallback((id: string) => {
    return highlights.find(h => h.id === id);
  }, [highlights]);

  return {
    highlights,
    loading,
    error,
    createHighlight,
    updateHighlight,
    deleteHighlight,
    refresh: fetchHighlights,
    getById,
  };
}
