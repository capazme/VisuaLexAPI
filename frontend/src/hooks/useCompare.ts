import { useState, useCallback, useEffect } from 'react';
import type { ArticleData } from '../types';

export interface CompareArticle {
  article: ArticleData;
  sourceNorma: {
    tipo_atto: string;
    numero_atto?: string;
    data?: string;
  };
  label: string;
}

export interface CompareState {
  isOpen: boolean;
  leftArticle: CompareArticle | null;
  rightArticle: CompareArticle | null;
  mode: 'side-by-side' | 'inline';
  syncScroll: boolean;
}

// Global compare state (singleton pattern for cross-component access)
let compareState: CompareState = {
  isOpen: false,
  leftArticle: null,
  rightArticle: null,
  mode: 'side-by-side',
  syncScroll: true,
};

type CompareListener = (state: CompareState) => void;
const listeners = new Set<CompareListener>();

function notifyListeners() {
  listeners.forEach((listener) => listener({ ...compareState }));
}

export function subscribeToCompare(listener: CompareListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCompareState(): CompareState {
  return { ...compareState };
}

export function setCompareState(update: Partial<CompareState>) {
  compareState = { ...compareState, ...update };
  notifyListeners();
}

export function openCompareWithArticle(article: CompareArticle) {
  if (!compareState.leftArticle) {
    // First article selected
    compareState = {
      ...compareState,
      isOpen: true,
      leftArticle: article,
      rightArticle: null,
    };
  } else if (!compareState.rightArticle) {
    // Second article selected
    compareState = {
      ...compareState,
      isOpen: true,
      rightArticle: article,
    };
  } else {
    // Replace right article
    compareState = {
      ...compareState,
      rightArticle: article,
    };
  }
  notifyListeners();
}

export function closeCompare() {
  compareState = {
    isOpen: false,
    leftArticle: null,
    rightArticle: null,
    mode: 'side-by-side',
    syncScroll: true,
  };
  notifyListeners();
}

export function swapCompareArticles() {
  if (compareState.leftArticle && compareState.rightArticle) {
    compareState = {
      ...compareState,
      leftArticle: compareState.rightArticle,
      rightArticle: compareState.leftArticle,
    };
    notifyListeners();
  }
}

export function removeCompareArticle(side: 'left' | 'right') {
  if (side === 'left') {
    compareState = {
      ...compareState,
      leftArticle: compareState.rightArticle,
      rightArticle: null,
    };
  } else {
    compareState = {
      ...compareState,
      rightArticle: null,
    };
  }
  notifyListeners();
}

/**
 * Hook for using compare functionality in React components
 */
export function useCompare() {
  const [state, setState] = useState<CompareState>(getCompareState);

  // Subscribe to changes
  useEffect(() => {
    const unsubscribe = subscribeToCompare(setState);
    return unsubscribe;
  }, []);

  const startCompare = useCallback((article: CompareArticle) => {
    openCompareWithArticle(article);
  }, []);

  const addToCompare = useCallback((article: CompareArticle) => {
    openCompareWithArticle(article);
  }, []);

  const close = useCallback(() => {
    closeCompare();
  }, []);

  const swap = useCallback(() => {
    swapCompareArticles();
  }, []);

  const remove = useCallback((side: 'left' | 'right') => {
    removeCompareArticle(side);
  }, []);

  const setMode = useCallback((mode: 'side-by-side' | 'inline') => {
    setCompareState({ mode });
  }, []);

  const setSyncScroll = useCallback((sync: boolean) => {
    setCompareState({ syncScroll: sync });
  }, []);

  return {
    ...state,
    startCompare,
    addToCompare,
    close,
    swap,
    remove,
    setMode,
    setSyncScroll,
    hasLeft: !!state.leftArticle,
    hasRight: !!state.rightArticle,
    isComplete: !!state.leftArticle && !!state.rightArticle,
  };
}
