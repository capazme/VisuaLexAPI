import { useStore } from 'zustand/react';
import { createStore } from 'zustand/vanilla';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuidv4 } from 'uuid';
import type { AppSettings, Bookmark, Dossier, Annotation, Highlight, NormaVisitata, ArticleData } from '../types';

interface AppState {
    settings: AppSettings;
    bookmarks: Bookmark[];
    dossiers: Dossier[];
    annotations: Annotation[];
    highlights: Highlight[];
    comparisonArticle: ArticleData | null;
    
    // Actions
    updateSettings: (settings: Partial<AppSettings>) => void;
    
    addBookmark: (norma: NormaVisitata, tags?: string[]) => void;
    updateBookmarkTags: (normaKey: string, tags: string[]) => void;
    removeBookmark: (normaKey: string) => void;
    isBookmarked: (normaKey: string) => boolean;
    
    createDossier: (title: string, description?: string) => void;
    deleteDossier: (id: string) => void;
    addToDossier: (dossierId: string, item: any, type: 'norma' | 'note') => void;
    removeFromDossier: (dossierId: string, itemId: string) => void;
    
    addAnnotation: (normaKey: string, articleId: string, text: string) => void;
    removeAnnotation: (id: string) => void;
    
    addHighlight: (normaKey: string, articleId: string, text: string, range: string, color: Highlight['color']) => void;
    removeHighlight: (id: string) => void;
    getHighlights: (normaKey: string, articleId: string) => Highlight[];

    setComparisonArticle: (article: ArticleData) => void;
    clearComparisonArticle: () => void;
}

const DEFAULT_SETTINGS: AppSettings = {
    theme: 'light',
    fontSize: 'medium',
    fontFamily: 'sans',
    focusMode: false,
    splitView: false,
};

// Helper to generate consistent keys for bookmarks
const generateKey = (n: NormaVisitata) => {
    const sanitize = (str: string) => str.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();
    const parts = [n.tipo_atto];
    if (n.numero_atto?.trim()) parts.push(n.numero_atto);
    if (n.data?.trim()) parts.push(n.data);
    if (n.numero_articolo?.trim()) parts.push(n.numero_articolo);
    return parts.map(part => sanitize(part || '')).join('--');
};

const appStore = createStore<AppState>()(
    persist(
        immer((set, get) => ({
            settings: DEFAULT_SETTINGS,
            bookmarks: [],
            dossiers: [],
            annotations: [],
            highlights: [],
            comparisonArticle: null,

            updateSettings: (newSettings) => set((state) => {
                state.settings = { ...state.settings, ...newSettings };
            }),

            addBookmark: (norma, tags = []) => set((state) => {
                const key = generateKey(norma);
                if (!state.bookmarks.find(b => b.normaKey === key)) {
                    state.bookmarks.push({
                        id: uuidv4(),
                        normaKey: key,
                        normaData: norma,
                        addedAt: new Date().toISOString(),
                        tags
                    });
                }
            }),

            updateBookmarkTags: (key, tags) => set((state) => {
                const bookmark = state.bookmarks.find(b => b.normaKey === key);
                if (bookmark) {
                    bookmark.tags = tags;
                }
            }),

            removeBookmark: (key) => set((state) => {
                state.bookmarks = state.bookmarks.filter(b => b.normaKey !== key);
            }),

            isBookmarked: (key) => {
                return !!get().bookmarks.find(b => b.normaKey === key);
            },

            createDossier: (title, description) => set((state) => {
                state.dossiers.push({
                    id: uuidv4(),
                    title,
                    description,
                    createdAt: new Date().toISOString(),
                    items: []
                });
            }),

            deleteDossier: (id) => set((state) => {
                state.dossiers = state.dossiers.filter(d => d.id !== id);
            }),

            addToDossier: (dossierId, itemData, type) => set((state) => {
                const dossier = state.dossiers.find(d => d.id === dossierId);
                if (dossier) {
                    dossier.items.push({
                        id: uuidv4(),
                        type,
                        data: itemData,
                        addedAt: new Date().toISOString()
                    });
                }
            }),

            removeFromDossier: (dossierId, itemId) => set((state) => {
                const dossier = state.dossiers.find(d => d.id === dossierId);
                if (dossier) {
                    dossier.items = dossier.items.filter(i => i.id !== itemId);
                }
            }),

            addAnnotation: (normaKey, articleId, text) => set((state) => {
                state.annotations.push({
                    id: uuidv4(),
                    normaKey,
                    articleId,
                    text,
                    createdAt: new Date().toISOString()
                });
            }),

            removeAnnotation: (id) => set((state) => {
                state.annotations = state.annotations.filter(a => a.id !== id);
            }),

            addHighlight: (normaKey, articleId, text, range, color) => set((state) => {
                 state.highlights.push({
                     id: uuidv4(),
                     normaKey,
                     articleId,
                     text,
                     rangeSerialized: range,
                     color
                 });
            }),

            removeHighlight: (id) => set((state) => {
                state.highlights = state.highlights.filter(h => h.id !== id);
            }),

            getHighlights: (normaKey, articleId) => {
                return get().highlights.filter(h => h.normaKey === normaKey && h.articleId === articleId);
            },

            setComparisonArticle: (article) => set((state) => {
                state.comparisonArticle = article;
            }),

            clearComparisonArticle: () => set((state) => {
                state.comparisonArticle = null;
            })
        })),
        {
            name: 'visualex-storage',
        }
    )
);

export function useAppStore(): AppState;
export function useAppStore<T>(selector: (state: AppState) => T): T;
export function useAppStore<T>(selector?: (state: AppState) => T) {
    if (selector) {
        return useStore(appStore, selector);
    }
    return useStore(appStore);
}

