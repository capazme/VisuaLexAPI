import { useStore } from 'zustand/react';
import { createStore } from 'zustand/vanilla';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuidv4 } from 'uuid';
import type { AppSettings, Bookmark, Dossier, Annotation, Highlight, NormaVisitata, ArticleData, SearchParams, QuickNorm } from '../types';

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

interface CollectionArticle {
    article: ArticleData;
    sourceNorma: any;
}

interface ArticleCollection {
    type: 'collection';
    id: string;
    label: string;
    articles: CollectionArticle[];
    isCollapsed: boolean;
    color?: 'purple' | 'indigo';
}

type TabContent = NormaBlock | LooseArticle | ArticleCollection;

// Renamed from FloatingPanel to WorkspaceTab
interface WorkspaceTab {
    id: string;
    label: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
    zIndex: number;
    isPinned: boolean;
    isMinimized: boolean;
    isHidden: boolean;
    content: TabContent[]; // Mixed norme and loose articles
}

interface SearchPanelState {
    isCollapsed: boolean;
    position: { x: number; y: number };
    zIndex: number;  // Dynamic z-index for stacking order
}

interface AppState {
    settings: AppSettings;
    bookmarks: Bookmark[];
    dossiers: Dossier[];
    annotations: Annotation[];
    highlights: Highlight[];
    quickNorms: QuickNorm[];

    // UI State
    sidebarVisible: boolean;
    commandPaletteOpen: boolean;
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
    openCommandPalette: () => void;
    closeCommandPalette: () => void;
    toggleSearchPanel: () => void;
    setSearchPanelPosition: (position: { x: number; y: number }) => void;
    bringSearchPanelToFront: () => void;  // Bring search panel to front

    // Workspace Tab Actions
    addWorkspaceTab: (label: string, norma?: any, articles?: ArticleData[]) => string;
    addNormaToTab: (tabId: string, norma: any, articles: ArticleData[]) => void;
    addLooseArticleToTab: (tabId: string, article: ArticleData, sourceNorma: any) => void;
    updateTab: (id: string, updates: Partial<WorkspaceTab>) => void;
    removeTab: (id: string) => void;
    bringTabToFront: (id: string) => void;
    toggleTabPin: (id: string) => void;
    toggleTabMinimize: (id: string) => void;
    toggleTabVisibility: (id: string) => void;
    toggleNormaCollapse: (tabId: string, normaId: string) => void;
    setTabLabel: (id: string, label: string) => void;

    // Drag & Drop Actions
    moveNormaBetweenTabs: (normaId: string, sourceTabId: string, targetTabId: string) => void;
    extractArticleFromNorma: (tabId: string, normaId: string, articleId: string) => void;
    moveLooseArticleBetweenTabs: (articleId: string, sourceTabId: string, targetTabId: string) => void;
    removeArticleFromNorma: (tabId: string, normaId: string, articleId: string) => void;
    removeContentFromTab: (tabId: string, contentId: string) => void;
    mergeLooseArticleToNorma: (tabId: string, looseArticleId: string, targetNormaId: string) => boolean;

    // Collection Actions
    createCollection: (tabId: string, label?: string) => string;
    renameCollection: (tabId: string, collectionId: string, newLabel: string) => void;
    addArticleToCollection: (tabId: string, collectionId: string, article: ArticleData, sourceNorma: any) => void;
    removeArticleFromCollection: (tabId: string, collectionId: string, articleKey: string) => void;
    toggleCollectionCollapse: (tabId: string, collectionId: string) => void;
    moveLooseArticleToCollection: (tabId: string, looseArticleId: string, collectionId: string) => void;

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

    // QuickNorm Actions
    addQuickNorm: (label: string, searchParams: SearchParams, sourceUrl?: string) => void;
    removeQuickNorm: (id: string) => void;
    updateQuickNormLabel: (id: string, label: string) => void;
    useQuickNorm: (id: string) => QuickNorm | undefined;
    getQuickNormsSorted: () => QuickNorm[];
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
            quickNorms: [],

            // Search State
            searchTrigger: null,

            // UI State
            sidebarVisible: true,
            commandPaletteOpen: false,
            searchPanelState: {
                isCollapsed: false,
                position: { x: window.innerWidth - 420, y: 20 },
                zIndex: 1000  // Start high so it's above tabs
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

            openCommandPalette: () => set((state) => {
                state.commandPaletteOpen = true;
            }),

            closeCommandPalette: () => set((state) => {
                state.commandPaletteOpen = false;
            }),

            toggleSearchPanel: () => set((state) => {
                state.searchPanelState.isCollapsed = !state.searchPanelState.isCollapsed;
            }),

            setSearchPanelPosition: (position) => set((state) => {
                state.searchPanelState.position = position;
            }),

            bringSearchPanelToFront: () => set((state) => {
                state.searchPanelState.zIndex = ++state.highestZIndex;
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
                        isHidden: false,
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

            toggleTabVisibility: (id) => set((state) => {
                const tab = state.workspaceTabs.find(t => t.id === id);
                if (tab) {
                    tab.isHidden = !tab.isHidden;
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

            removeContentFromTab: (tabId, contentId) => set((state) => {
                const tab = state.workspaceTabs.find(t => t.id === tabId);
                if (!tab) return;

                tab.content = tab.content.filter(c => c.id !== contentId);

                // Remove tab if empty
                if (tab.content.length === 0) {
                    state.workspaceTabs = state.workspaceTabs.filter(t => t.id !== tabId);
                }
            }),

            mergeLooseArticleToNorma: (tabId, looseArticleId, targetNormaId) => {
                let success = false;
                set((state) => {
                    const tab = state.workspaceTabs.find(t => t.id === tabId);
                    if (!tab) return;

                    // Find the loose article
                    const looseIndex = tab.content.findIndex(
                        c => c.type === 'loose-article' && c.id === looseArticleId
                    );
                    if (looseIndex === -1) return;

                    const loose = tab.content[looseIndex] as LooseArticle;

                    // Find the target norma block
                    const targetNorma = tab.content.find(
                        c => c.type === 'norma' && c.id === targetNormaId
                    ) as NormaBlock | undefined;
                    if (!targetNorma) return;

                    // Verify compatibility: same source norma
                    const isSameNorma =
                        loose.sourceNorma.tipo_atto === targetNorma.norma.tipo_atto &&
                        loose.sourceNorma.numero_atto === targetNorma.norma.numero_atto &&
                        loose.sourceNorma.data === targetNorma.norma.data;

                    if (!isSameNorma) return;

                    // Check for duplicate article
                    const articleNumber = loose.article.norma_data.numero_articolo;
                    const isDuplicate = targetNorma.articles.some(
                        a => a.norma_data.numero_articolo === articleNumber
                    );

                    if (isDuplicate) return;

                    // Add article to norma block and sort
                    targetNorma.articles.push(loose.article);
                    targetNorma.articles.sort((a, b) => {
                        const numA = parseInt(a.norma_data.numero_articolo) || 0;
                        const numB = parseInt(b.norma_data.numero_articolo) || 0;
                        return numA - numB;
                    });

                    // Remove loose article
                    tab.content.splice(looseIndex, 1);
                    success = true;
                });
                return success;
            },

            // Collection Actions
            createCollection: (tabId, label) => {
                let collectionId = '';
                set((state) => {
                    const tab = state.workspaceTabs.find(t => t.id === tabId);
                    if (!tab) return;

                    const newCollection: ArticleCollection = {
                        type: 'collection',
                        id: uuidv4(),
                        label: label || 'Nuova Raccolta',
                        articles: [],
                        isCollapsed: false,
                        color: 'purple'
                    };

                    tab.content.push(newCollection);
                    collectionId = newCollection.id;
                });
                return collectionId;
            },

            renameCollection: (tabId, collectionId, newLabel) => set((state) => {
                const tab = state.workspaceTabs.find(t => t.id === tabId);
                if (!tab) return;

                const collection = tab.content.find(
                    c => c.type === 'collection' && c.id === collectionId
                ) as ArticleCollection | undefined;

                if (collection) {
                    collection.label = newLabel;
                }
            }),

            addArticleToCollection: (tabId, collectionId, article, sourceNorma) => set((state) => {
                const tab = state.workspaceTabs.find(t => t.id === tabId);
                if (!tab) return;

                const collection = tab.content.find(
                    c => c.type === 'collection' && c.id === collectionId
                ) as ArticleCollection | undefined;

                if (!collection) return;

                // Check for duplicates
                const articleKey = `${sourceNorma.tipo_atto}-${sourceNorma.numero_atto}-${article.norma_data.numero_articolo}`;
                const exists = collection.articles.some(
                    a => `${a.sourceNorma.tipo_atto}-${a.sourceNorma.numero_atto}-${a.article.norma_data.numero_articolo}` === articleKey
                );

                if (!exists) {
                    collection.articles.push({ article, sourceNorma });
                }
            }),

            removeArticleFromCollection: (tabId, collectionId, articleKey) => set((state) => {
                const tab = state.workspaceTabs.find(t => t.id === tabId);
                if (!tab) return;

                const collection = tab.content.find(
                    c => c.type === 'collection' && c.id === collectionId
                ) as ArticleCollection | undefined;

                if (!collection) return;

                collection.articles = collection.articles.filter(
                    a => `${a.sourceNorma.tipo_atto}-${a.sourceNorma.numero_atto}-${a.article.norma_data.numero_articolo}` !== articleKey
                );

                // Remove empty collection
                if (collection.articles.length === 0) {
                    tab.content = tab.content.filter(c => c.id !== collectionId);
                }
            }),

            toggleCollectionCollapse: (tabId, collectionId) => set((state) => {
                const tab = state.workspaceTabs.find(t => t.id === tabId);
                if (!tab) return;

                const collection = tab.content.find(
                    c => c.type === 'collection' && c.id === collectionId
                ) as ArticleCollection | undefined;

                if (collection) {
                    collection.isCollapsed = !collection.isCollapsed;
                }
            }),

            moveLooseArticleToCollection: (tabId, looseArticleId, collectionId) => set((state) => {
                const tab = state.workspaceTabs.find(t => t.id === tabId);
                if (!tab) return;

                // Find and remove loose article
                const looseIndex = tab.content.findIndex(
                    c => c.type === 'loose-article' && c.id === looseArticleId
                );
                if (looseIndex === -1) return;

                const loose = tab.content[looseIndex] as LooseArticle;

                // Find target collection
                const collection = tab.content.find(
                    c => c.type === 'collection' && c.id === collectionId
                ) as ArticleCollection | undefined;

                if (!collection) return;

                // Check for duplicates
                const articleKey = `${loose.sourceNorma.tipo_atto}-${loose.sourceNorma.numero_atto}-${loose.article.norma_data.numero_articolo}`;
                const exists = collection.articles.some(
                    a => `${a.sourceNorma.tipo_atto}-${a.sourceNorma.numero_atto}-${a.article.norma_data.numero_articolo}` === articleKey
                );

                if (!exists) {
                    collection.articles.push({
                        article: loose.article,
                        sourceNorma: loose.sourceNorma
                    });
                }

                // Remove loose article
                tab.content.splice(looseIndex, 1);
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
            }),

            // QuickNorm Actions
            addQuickNorm: (label, searchParams, sourceUrl) => set((state) => {
                // Check for duplicates based on search params
                const isDuplicate = state.quickNorms.some(
                    qn => qn.searchParams.act_type === searchParams.act_type &&
                          qn.searchParams.article === searchParams.article &&
                          qn.searchParams.act_number === searchParams.act_number &&
                          qn.searchParams.date === searchParams.date
                );

                if (!isDuplicate) {
                    state.quickNorms.push({
                        id: uuidv4(),
                        label,
                        searchParams,
                        sourceUrl,
                        createdAt: new Date().toISOString(),
                        usageCount: 0,
                        lastUsedAt: undefined
                    });
                }
            }),

            removeQuickNorm: (id) => set((state) => {
                state.quickNorms = state.quickNorms.filter(qn => qn.id !== id);
            }),

            updateQuickNormLabel: (id, label) => set((state) => {
                const qn = state.quickNorms.find(q => q.id === id);
                if (qn) {
                    qn.label = label;
                }
            }),

            useQuickNorm: (id) => {
                const state = get();
                const qn = state.quickNorms.find(q => q.id === id);
                if (qn) {
                    // Update usage stats
                    set((state) => {
                        const quickNorm = state.quickNorms.find(q => q.id === id);
                        if (quickNorm) {
                            quickNorm.usageCount += 1;
                            quickNorm.lastUsedAt = new Date().toISOString();
                        }
                    });
                    return qn;
                }
                return undefined;
            },

            getQuickNormsSorted: () => {
                const state = get();
                // Sort by usage count (descending), then by last used (most recent first)
                return [...state.quickNorms].sort((a, b) => {
                    if (b.usageCount !== a.usageCount) {
                        return b.usageCount - a.usageCount;
                    }
                    if (a.lastUsedAt && b.lastUsedAt) {
                        return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
                    }
                    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                });
            }
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

// Export store for direct access (e.g., appStore.getState())
export { appStore };

// Export types
export type { WorkspaceTab, NormaBlock, LooseArticle, ArticleCollection, CollectionArticle, TabContent, SearchPanelState };

