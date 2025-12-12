import { useStore } from 'zustand/react';
import { createStore } from 'zustand/vanilla';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuidv4 } from 'uuid';
import type { AppSettings, Bookmark, Dossier, Annotation, Highlight, NormaVisitata, ArticleData, SearchParams } from '../types';

// Content types for WorkspaceTab
interface NormaBlock {
    type: 'norma';
    id: string;
    norma: any;
    articles: ArticleData[];
    isCollapsed: boolean;
}

interface LooseArticle {
    type: 'loose-article';
    id: string;
    article: ArticleData;
    sourceNorma: any;
}

type TabContent = NormaBlock | LooseArticle;

// Renamed from FloatingPanel to WorkspaceTab
interface WorkspaceTab {
    id: string;
    label: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
    zIndex: number;
    isPinned: boolean;
    isMinimized: boolean;
    content: TabContent[]; // Mixed norme and loose articles
}

interface SearchPanelState {
    isCollapsed: boolean;
    position: { x: number; y: number };
}

interface AppState {
    settings: AppSettings;
    bookmarks: Bookmark[];
    dossiers: Dossier[];
    annotations: Annotation[];
    highlights: Highlight[];

    // UI State
    sidebarVisible: boolean;
    searchPanelState: SearchPanelState;
    workspaceTabs: WorkspaceTab[];
    highestZIndex: number;

    // Search State
    searchTrigger: SearchParams | null;

    // Actions
    updateSettings: (settings: Partial<AppSettings>) => void;

    // UI Actions
    toggleSidebar: () => void;
    setSidebarVisible: (visible: boolean) => void;
    toggleSearchPanel: () => void;
    setSearchPanelPosition: (position: { x: number; y: number }) => void;

    // Workspace Tab Actions
    addWorkspaceTab: (label: string, norma?: any, articles?: ArticleData[]) => string;
    addNormaToTab: (tabId: string, norma: any, articles: ArticleData[]) => void;
    addLooseArticleToTab: (tabId: string, article: ArticleData, sourceNorma: any) => void;
    updateTab: (id: string, updates: Partial<WorkspaceTab>) => void;
    removeTab: (id: string) => void;
    bringTabToFront: (id: string) => void;
    toggleTabPin: (id: string) => void;
    toggleTabMinimize: (id: string) => void;
    toggleNormaCollapse: (tabId: string, normaId: string) => void;
    setTabLabel: (id: string, label: string) => void;

    // Drag & Drop Actions
    moveNormaBetweenTabs: (normaId: string, sourceTabId: string, targetTabId: string) => void;
    extractArticleFromNorma: (tabId: string, normaId: string, articleId: string) => void;
    moveLooseArticleBetweenTabs: (articleId: string, sourceTabId: string, targetTabId: string) => void;
    removeArticleFromNorma: (tabId: string, normaId: string, articleId: string) => void;
    
    addBookmark: (norma: NormaVisitata, tags?: string[]) => void;
    updateBookmarkTags: (normaKey: string, tags: string[]) => void;
    removeBookmark: (normaKey: string) => void;
    isBookmarked: (normaKey: string) => boolean;
    
    createDossier: (title: string, description?: string) => void;
    deleteDossier: (id: string) => void;
    updateDossier: (id: string, updates: { title?: string; description?: string; tags?: string[] }) => void;
    toggleDossierPin: (id: string) => void;
    addToDossier: (dossierId: string, item: any, type: 'norma' | 'note') => void;
    removeFromDossier: (dossierId: string, itemId: string) => void;
    reorderDossierItems: (dossierId: string, fromIndex: number, toIndex: number) => void;
    updateDossierItemStatus: (dossierId: string, itemId: string, status: string) => void;
    moveToDossier: (sourceDossierId: string, targetDossierId: string, itemIds: string[]) => void;
    
    addAnnotation: (normaKey: string, articleId: string, text: string) => void;
    removeAnnotation: (id: string) => void;
    
    addHighlight: (normaKey: string, articleId: string, text: string, range: string, color: Highlight['color']) => void;
    removeHighlight: (id: string) => void;
    getHighlights: (normaKey: string, articleId: string) => Highlight[];

    // Search Actions
    triggerSearch: (params: SearchParams) => void;
    clearSearchTrigger: () => void;
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

            // Search State
            searchTrigger: null,

            // UI State
            sidebarVisible: true,
            searchPanelState: {
                isCollapsed: false,
                position: { x: window.innerWidth - 420, y: 20 }
            },
            workspaceTabs: [],
            highestZIndex: 100,

            updateSettings: (newSettings) => set((state) => {
                state.settings = { ...state.settings, ...newSettings };
            }),

            // UI Actions
            toggleSidebar: () => set((state) => {
                state.sidebarVisible = !state.sidebarVisible;
            }),

            setSidebarVisible: (visible) => set((state) => {
                state.sidebarVisible = visible;
            }),

            toggleSearchPanel: () => set((state) => {
                state.searchPanelState.isCollapsed = !state.searchPanelState.isCollapsed;
            }),

            setSearchPanelPosition: (position) => set((state) => {
                state.searchPanelState.position = position;
            }),

            // Workspace Tab Actions - Complete refactor
            addWorkspaceTab: (label, norma, articles) => {
                let tabId = '';
                set((state) => {
                    const tabCount = state.workspaceTabs.length;
                    const cascade = (tabCount % 5) * 40;

                    const newTab: WorkspaceTab = {
                        id: uuidv4(),
                        label,
                        position: { x: 100 + cascade, y: 100 + cascade },
                        size: { width: 800, height: 650 },
                        zIndex: ++state.highestZIndex,
                        isPinned: false,
                        isMinimized: false,
                        content: []
                    };

                    if (norma && articles) {
                        const sortedArticles = [...articles].sort((a, b) => {
                            const numA = parseInt(a.norma_data.numero_articolo) || 0;
                            const numB = parseInt(b.norma_data.numero_articolo) || 0;
                            return numA - numB;
                        });

                        newTab.content.push({
                            type: 'norma',
                            id: uuidv4(),
                            norma,
                            articles: sortedArticles,
                            isCollapsed: false
                        });
                    }

                    state.workspaceTabs.push(newTab);
                    tabId = newTab.id;
                });
                return tabId;
            },

            addNormaToTab: (tabId, norma, articles) => set((state) => {
                const tab = state.workspaceTabs.find(t => t.id === tabId);
                if (!tab) return;

                const existingNorma = tab.content.find(
                    c => c.type === 'norma' &&
                    c.norma.tipo_atto === norma.tipo_atto &&
                    c.norma.numero_atto === norma.numero_atto &&
                    c.norma.data === norma.data
                ) as NormaBlock | undefined;

                if (existingNorma) {
                    const existingArticleIds = new Set(
                        existingNorma.articles.map(a => a.norma_data.numero_articolo)
                    );

                    const newArticles = articles.filter(
                        a => !existingArticleIds.has(a.norma_data.numero_articolo)
                    );

                    if (newArticles.length > 0) {
                        existingNorma.articles = [...existingNorma.articles, ...newArticles];
                        existingNorma.articles.sort((a, b) => {
                            const numA = parseInt(a.norma_data.numero_articolo) || 0;
                            const numB = parseInt(b.norma_data.numero_articolo) || 0;
                            return numA - numB;
                        });
                    }
                } else {
                    const sortedArticles = [...articles].sort((a, b) => {
                        const numA = parseInt(a.norma_data.numero_articolo) || 0;
                        const numB = parseInt(b.norma_data.numero_articolo) || 0;
                        return numA - numB;
                    });

                    tab.content.push({
                        type: 'norma',
                        id: uuidv4(),
                        norma,
                        articles: sortedArticles,
                        isCollapsed: false
                    });
                }

                tab.zIndex = ++state.highestZIndex;
            }),

            addLooseArticleToTab: (tabId, article, sourceNorma) => set((state) => {
                const tab = state.workspaceTabs.find(t => t.id === tabId);
                if (!tab) return;

                tab.content.push({
                    type: 'loose-article',
                    id: uuidv4(),
                    article,
                    sourceNorma
                });

                tab.zIndex = ++state.highestZIndex;
            }),

            updateTab: (id, updates) => set((state) => {
                const tab = state.workspaceTabs.find(t => t.id === id);
                if (tab) {
                    Object.assign(tab, updates);
                }
            }),

            removeTab: (id) => set((state) => {
                state.workspaceTabs = state.workspaceTabs.filter(t => t.id !== id);
            }),

            bringTabToFront: (id) => set((state) => {
                const tab = state.workspaceTabs.find(t => t.id === id);
                if (tab && !tab.isPinned) {
                    tab.zIndex = ++state.highestZIndex;
                }
            }),

            toggleTabPin: (id) => set((state) => {
                const tab = state.workspaceTabs.find(t => t.id === id);
                if (tab) {
                    tab.isPinned = !tab.isPinned;
                }
            }),

            toggleTabMinimize: (id) => set((state) => {
                const tab = state.workspaceTabs.find(t => t.id === id);
                if (tab) {
                    tab.isMinimized = !tab.isMinimized;
                }
            }),

            toggleNormaCollapse: (tabId, normaId) => set((state) => {
                const tab = state.workspaceTabs.find(t => t.id === tabId);
                if (!tab) return;

                const norma = tab.content.find(c => c.type === 'norma' && c.id === normaId) as NormaBlock | undefined;
                if (norma) {
                    norma.isCollapsed = !norma.isCollapsed;
                }
            }),

            setTabLabel: (id, label) => set((state) => {
                const tab = state.workspaceTabs.find(t => t.id === id);
                if (tab) {
                    tab.label = label;
                }
            }),

            moveNormaBetweenTabs: (normaId, sourceTabId, targetTabId) => set((state) => {
                const sourceTab = state.workspaceTabs.find(t => t.id === sourceTabId);
                const targetTab = state.workspaceTabs.find(t => t.id === targetTabId);
                if (!sourceTab || !targetTab) return;

                const normaIndex = sourceTab.content.findIndex(c => c.type === 'norma' && c.id === normaId);
                if (normaIndex === -1) return;

                const norma = sourceTab.content[normaIndex];
                sourceTab.content.splice(normaIndex, 1);
                targetTab.content.push(norma);

                targetTab.zIndex = ++state.highestZIndex;
            }),

            extractArticleFromNorma: (tabId, normaId, articleId) => set((state) => {
                const tab = state.workspaceTabs.find(t => t.id === tabId);
                if (!tab) return;

                const norma = tab.content.find(c => c.type === 'norma' && c.id === normaId) as NormaBlock | undefined;
                if (!norma) return;

                const article = norma.articles.find(a => a.norma_data.numero_articolo === articleId);
                if (!article) return;

                norma.articles = norma.articles.filter(a => a.norma_data.numero_articolo !== articleId);

                if (norma.articles.length === 0) {
                    tab.content = tab.content.filter(c => c.id !== normaId);
                }

                tab.content.push({
                    type: 'loose-article',
                    id: uuidv4(),
                    article,
                    sourceNorma: norma.norma
                });
            }),

            moveLooseArticleBetweenTabs: (articleId, sourceTabId, targetTabId) => set((state) => {
                const sourceTab = state.workspaceTabs.find(t => t.id === sourceTabId);
                const targetTab = state.workspaceTabs.find(t => t.id === targetTabId);
                if (!sourceTab || !targetTab) return;

                const articleIndex = sourceTab.content.findIndex(c => c.type === 'loose-article' && c.id === articleId);
                if (articleIndex === -1) return;

                const looseArticle = sourceTab.content[articleIndex];
                sourceTab.content.splice(articleIndex, 1);
                targetTab.content.push(looseArticle);

                targetTab.zIndex = ++state.highestZIndex;
            }),

            removeArticleFromNorma: (tabId, normaId, articleId) => set((state) => {
                const tab = state.workspaceTabs.find(t => t.id === tabId);
                if (!tab) return;

                const norma = tab.content.find(c => c.type === 'norma' && c.id === normaId) as NormaBlock | undefined;
                if (!norma) return;

                norma.articles = norma.articles.filter(a => a.norma_data.numero_articolo !== articleId);

                if (norma.articles.length === 0) {
                    tab.content = tab.content.filter(c => c.id !== normaId);
                }

                if (tab.content.length === 0) {
                    state.workspaceTabs = state.workspaceTabs.filter(t => t.id !== tabId);
                }
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

            updateDossier: (id, updates) => set((state) => {
                const dossier = state.dossiers.find(d => d.id === id);
                if (dossier) {
                    if (updates.title !== undefined) dossier.title = updates.title;
                    if (updates.description !== undefined) dossier.description = updates.description;
                    if (updates.tags !== undefined) dossier.tags = updates.tags;
                }
            }),

            toggleDossierPin: (id) => set((state) => {
                const dossier = state.dossiers.find(d => d.id === id);
                if (dossier) {
                    dossier.isPinned = !dossier.isPinned;
                }
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

            reorderDossierItems: (dossierId, fromIndex, toIndex) => set((state) => {
                const dossier = state.dossiers.find(d => d.id === dossierId);
                if (dossier && fromIndex !== toIndex) {
                    const items = [...dossier.items];
                    const [removed] = items.splice(fromIndex, 1);
                    items.splice(toIndex, 0, removed);
                    dossier.items = items;
                }
            }),

            updateDossierItemStatus: (dossierId, itemId, status) => set((state) => {
                const dossier = state.dossiers.find(d => d.id === dossierId);
                if (dossier) {
                    const item = dossier.items.find(i => i.id === itemId);
                    if (item) {
                        item.status = status;
                    }
                }
            }),

            moveToDossier: (sourceDossierId, targetDossierId, itemIds) => set((state) => {
                const source = state.dossiers.find(d => d.id === sourceDossierId);
                const target = state.dossiers.find(d => d.id === targetDossierId);
                if (source && target) {
                    const itemsToMove = source.items.filter(i => itemIds.includes(i.id));
                    source.items = source.items.filter(i => !itemIds.includes(i.id));
                    target.items.push(...itemsToMove);
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

            // Search Actions
            triggerSearch: (params) => set((state) => {
                state.searchTrigger = params;
            }),

            clearSearchTrigger: () => set((state) => {
                state.searchTrigger = null;
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

// Export types
export type { WorkspaceTab, NormaBlock, LooseArticle, TabContent, SearchPanelState };

