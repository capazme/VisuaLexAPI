import { useState, useEffect, useCallback } from 'react';
import { annotationService } from '../services/annotationService';
import type { Annotation, AnnotationCreate, AnnotationUpdate } from '../types/api';

interface UseAnnotationsReturn {
  annotations: Annotation[];
  loading: boolean;
  error: string | null;
  createAnnotation: (data: AnnotationCreate) => Promise<Annotation>;
  updateAnnotation: (id: string, data: AnnotationUpdate) => Promise<Annotation>;
  deleteAnnotation: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  getById: (id: string) => Annotation | undefined;
  getByType: (type: string) => Annotation[];
}

export function useAnnotations(normaKey: string | null): UseAnnotationsReturn {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch annotations for specific article
  const fetchAnnotations = useCallback(async () => {
    if (!normaKey) {
      setAnnotations([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await annotationService.getByNormaKey(normaKey);
      setAnnotations(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch annotations');
      console.error('Error fetching annotations:', err);
    } finally {
      setLoading(false);
    }
  }, [normaKey]);

  // Load on mount and when normaKey changes
  useEffect(() => {
    fetchAnnotations();
  }, [fetchAnnotations]);

  // Create annotation (optimistic update)
  const createAnnotation = useCallback(async (data: AnnotationCreate): Promise<Annotation> => {
    setError(null);
    try {
      const newAnnotation = await annotationService.create(data);
      setAnnotations(prev => [...prev, newAnnotation]);
      return newAnnotation;
    } catch (err: any) {
      setError(err.message || 'Failed to create annotation');
      throw err;
    }
  }, []);

  // Update annotation (optimistic update)
  const updateAnnotation = useCallback(async (id: string, data: AnnotationUpdate): Promise<Annotation> => {
    setError(null);
    const previousAnnotations = annotations;
    setAnnotations(prev => prev.map(a => a.id === id ? { ...a, ...data } : a));

    try {
      const updated = await annotationService.update(id, data);
      setAnnotations(prev => prev.map(a => a.id === id ? updated : a));
      return updated;
    } catch (err: any) {
      setAnnotations(previousAnnotations);
      setError(err.message || 'Failed to update annotation');
      throw err;
    }
  }, [annotations]);

  // Delete annotation (optimistic update)
  const deleteAnnotation = useCallback(async (id: string): Promise<void> => {
    setError(null);
    const previousAnnotations = annotations;
    setAnnotations(prev => prev.filter(a => a.id !== id));

    try {
      await annotationService.delete(id);
    } catch (err: any) {
      setAnnotations(previousAnnotations);
      setError(err.message || 'Failed to delete annotation');
      throw err;
    }
  }, [annotations]);

  // Helpers
  const getById = useCallback((id: string) => {
    return annotations.find(a => a.id === id);
  }, [annotations]);

  const getByType = useCallback((type: string) => {
    return annotations.filter(a => a.annotationType === type);
  }, [annotations]);

  return {
    annotations,
    loading,
    error,
    createAnnotation,
    updateAnnotation,
    deleteAnnotation,
    refresh: fetchAnnotations,
    getById,
    getByType,
  };
}
