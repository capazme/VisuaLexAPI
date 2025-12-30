import { useStore } from 'zustand/react';
import { createStore } from 'zustand/vanilla';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuidv4 } from 'uuid';
import type { AppSettings, Bookmark, Dossier, Annotation, Highlight, NormaVisitata, ArticleData, SearchParams, QuickNorm, CustomAlias, Environment, EnvironmentCategory } from '../types';
import { filterEnvironmentBySelection, type EnvironmentSelection } from '../utils/environmentUtils';

// Services for API sync
import { bookmarkService } from '../services/bookmarkService';
import { dossierService, type DossierApi } from '../services/dossierService';
// Note: annotationService and highlightService will be used when per-article sync is implemented
// import { annotationService } from '../services/annotationService';
// import { highlightService } from '../services/highlightService';

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
    customAliases: CustomAlias[];
    environments: Environment[];

    // Data Loading State (for API sync)
    isLoadingData: boolean;
    dataError: string | null;
    isDataLoaded: boolean;

    // UI State
    sidebarVisible: boolean;
    commandPaletteOpen: boolean;
    quickNormsManagerOpen: boolean;
    aliasManagerOpen: boolean;
    searchPanelState: SearchPanelState;
    workspaceTabs: WorkspaceTab[];
    highestZIndex: number;

    // Search State
    searchTrigger: SearchParams | null;

    // Actions
    updateSettings: (settings: Partial<AppSettings>) => void;

    // Data Sync Actions (API)
    fetchUserData: () => Promise<void>;
    clearUserData: () => void;

    // UI Actions
    toggleSidebar: () => void;
    setSidebarVisible: (visible: boolean) => void;
    openCommandPalette: () => void;
    closeCommandPalette: () => void;
    openQuickNormsManager: () => void;
    closeQuickNormsManager: () => void;
    openAliasManager: () => void;
    closeAliasManager: () => void;
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
    updateDossierItemStatus: (dossierId: string, itemId: string, status: 'unread' | 'reading' | 'important' | 'done') => void;
    moveToDossier: (sourceDossierId: string, targetDossierId: string, itemIds: string[]) => void;
    importDossier: (dossier: Dossier) => string; // returns new dossier ID

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
    removeQuickNormByParams: (searchParams: SearchParams) => void;
    updateQuickNormLabel: (id: string, label: string) => void;
    selectQuickNorm: (id: string) => QuickNorm | undefined;
    getQuickNormsSorted: () => QuickNorm[];
    isQuickNorm: (searchParams: SearchParams) => boolean;

    // CustomAlias Actions
    addCustomAlias: (alias: Omit<CustomAlias, 'id' | 'createdAt' | 'usageCount'>) => boolean;
    updateCustomAlias: (id: string, updates: Partial<Omit<CustomAlias, 'id' | 'createdAt'>>) => void;
    removeCustomAlias: (id: string) => void;
    trackAliasUsage: (id: string) => void;
    resolveAlias: (input: string) => {
        found: boolean;
        alias?: CustomAlias;
        resolvedActType?: string;
        resolvedParams?: Partial<SearchParams>;
    };
    isAliasTriggerTaken: (trigger: string, excludeId?: string) => boolean;
    getCustomAliasesSorted: () => CustomAlias[];

    // Environment Actions
    createEnvironment: (name: string, options?: { description?: string; category?: EnvironmentCategory; fromCurrent?: boolean }) => string;
    createEnvironmentWithSelection: (name: string, selection: EnvironmentSelection, options?: { description?: string; author?: string; version?: string; category?: EnvironmentCategory }) => string;
    updateEnvironment: (id: string, updates: Partial<Omit<Environment, 'id' | 'createdAt'>>) => void;
    deleteEnvironment: (id: string) => void;
    importEnvironment: (env: Environment) => string;
    importEnvironmentPartial: (envData: Partial<Environment>, selection: EnvironmentSelection, mode: 'merge' | 'replace') => void;
    applyEnvironment: (id: string, mode: 'replace' | 'merge') => void;
    refreshEnvironmentFromCurrent: (id: string) => void;
    getCurrentStateAsEnvironment: (name: string) => Environment;
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
    if (n.allegato?.trim()) parts.push(`all${n.allegato}`); // Include attachment info
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
            customAliases: [],
            environments: [],

            // Data Loading State
            isLoadingData: false,
            dataError: null,
            isDataLoaded: false,

            // Search State
            searchTrigger: null,

            // UI State
            sidebarVisible: true,
            commandPaletteOpen: false,
            quickNormsManagerOpen: false,
            aliasManagerOpen: false,
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

            // Data Sync Actions
            fetchUserData: async () => {
                set((state) => {
                    state.isLoadingData = true;
                    state.dataError = null;
                });

                try {
                    // Fetch all user data in parallel
                    const [bookmarksRes, dossiersRes] = await Promise.all([
                        bookmarkService.getAll().catch(() => []),
                        dossierService.getAll().catch(() => []),
                        // Note: annotations and highlights are fetched per-article, not all at once
                    ]);

                    // Transform API bookmarks to local format
                    const bookmarks: Bookmark[] = bookmarksRes.map((b: any) => ({
                        id: b.id,
                        normaKey: b.normaKey,
                        normaData: b.normaData,
                        addedAt: b.createdAt,
                        tags: b.tags || [],
                    }));

                    // Transform API dossiers to local format
                    const dossiers: Dossier[] = dossiersRes.map((d: DossierApi) => ({
                        id: d.id,
                        title: d.name,
                        description: d.description || undefined,
                        createdAt: d.created_at,
                        items: d.items.map(item => ({
                            id: item.id,
                            type: item.item_type === 'norm' ? 'norma' : 'note',
                            data: item.content,
                            addedAt: item.created_at,
                        })),
                        tags: [],
                        isPinned: false,
                    }));

                    set((state) => {
                        state.bookmarks = bookmarks;
                        state.dossiers = dossiers;
                        state.isLoadingData = false;
                        state.isDataLoaded = true;
                    });
                } catch (error: any) {
                    console.error('Failed to fetch user data:', error);
                    set((state) => {
                        state.isLoadingData = false;
                        state.dataError = error.message || 'Failed to load user data';
                    });
                }
            },

            clearUserData: () => set((state) => {
                // Clear all user-specific data
                state.bookmarks = [];
                state.dossiers = [];
                state.annotations = [];
                state.highlights = [];
                state.quickNorms = [];
                state.environments = [];
                state.isDataLoaded = false;
                state.dataError = null;

                // Clear workspace tabs to ensure user isolation
                // Each user should start with a clean workspace
                state.workspaceTabs = [];
                state.highestZIndex = 100;
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

            openQuickNormsManager: () => set((state) => {
                state.quickNormsManagerOpen = true;
            }),

            closeQuickNormsManager: () => set((state) => {
                state.quickNormsManagerOpen = false;
            }),

            openAliasManager: () => set((state) => {
                state.aliasManagerOpen = true;
            }),

            closeAliasManager: () => set((state) => {
                state.aliasManagerOpen = false;
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
                            // Sort by attachment first, then number
                            if (a.norma_data.allegato !== b.norma_data.allegato) {
                                if (!a.norma_data.allegato) return -1;
                                if (!b.norma_data.allegato) return 1;
                                return a.norma_data.allegato.localeCompare(b.norma_data.allegato, undefined, { numeric: true });
                            }
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

                // Helper to get a unique key for an article within a norma block
                const getArticleKey = (a: ArticleData) => {
                    return a.norma_data.allegato
                        ? `all${a.norma_data.allegato}:${a.norma_data.numero_articolo}`
                        : a.norma_data.numero_articolo;
                };

                const existingNorma = tab.content.find(
                    c => c.type === 'norma' &&
                        c.norma.tipo_atto === norma.tipo_atto &&
                        c.norma.numero_atto === norma.numero_atto &&
                        c.norma.data === norma.data
                ) as NormaBlock | undefined;

                if (existingNorma) {
                    const existingArticleKeys = new Set(
                        existingNorma.articles.map(getArticleKey)
                    );

                    const newArticles = articles.filter(
                        a => !existingArticleKeys.has(getArticleKey(a))
                    );

                    if (newArticles.length > 0) {
                        existingNorma.articles = [...existingNorma.articles, ...newArticles];
                        existingNorma.articles.sort((a, b) => {
                            // Sort by attachment first, then number
                            if (a.norma_data.allegato !== b.norma_data.allegato) {
                                if (!a.norma_data.allegato) return -1;
                                if (!b.norma_data.allegato) return 1;
                                return a.norma_data.allegato.localeCompare(b.norma_data.allegato, undefined, { numeric: true });
                            }
                            const numA = parseInt(a.norma_data.numero_articolo) || 0;
                            const numB = parseInt(b.norma_data.numero_articolo) || 0;
                            return numA - numB;
                        });
                    }
                } else {
                    const sortedArticles = [...articles].sort((a, b) => {
                        if (a.norma_data.allegato !== b.norma_data.allegato) {
                            if (!a.norma_data.allegato) return -1;
                            if (!b.norma_data.allegato) return 1;
                            return a.norma_data.allegato.localeCompare(b.norma_data.allegato, undefined, { numeric: true });
                        }
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

                // Helper to get a unique key for comparison
                const getArticleKey = (a: ArticleData) => {
                    return a.norma_data.allegato
                        ? `all${a.norma_data.allegato}:${a.norma_data.numero_articolo}`
                        : a.norma_data.numero_articolo;
                };

                const article = norma.articles.find(a => getArticleKey(a) === articleId);
                if (!article) return;

                norma.articles = norma.articles.filter(a => getArticleKey(a) !== articleId);

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

                const getArticleKey = (a: ArticleData) => {
                    return a.norma_data.allegato
                        ? `all${a.norma_data.allegato}:${a.norma_data.numero_articolo}`
                        : a.norma_data.numero_articolo;
                };

                norma.articles = norma.articles.filter(a => getArticleKey(a) !== articleId);

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

            addBookmark: (norma, tags = []) => {
                const key = generateKey(norma);
                const tempId = uuidv4();

                // Optimistic update
                set((state) => {
                    if (!state.bookmarks.find(b => b.normaKey === key)) {
                        state.bookmarks.push({
                            id: tempId,
                            normaKey: key,
                            normaData: norma,
                            addedAt: new Date().toISOString(),
                            tags
                        });
                    }
                });

                // API call in background
                bookmarkService.create({
                    norma_key: key,
                    norma_data: norma,
                    tags,
                }).then(created => {
                    // Update with server ID
                    set((state) => {
                        const bookmark = state.bookmarks.find(b => b.id === tempId);
                        if (bookmark) {
                            bookmark.id = created.id;
                        }
                    });
                }).catch(err => {
                    console.error('Failed to create bookmark:', err);
                    // Rollback on error
                    set((state) => {
                        state.bookmarks = state.bookmarks.filter(b => b.id !== tempId);
                    });
                });
            },

            updateBookmarkTags: (key, tags) => {
                const state = get();
                const bookmark = state.bookmarks.find(b => b.normaKey === key);
                if (!bookmark) return;

                // Optimistic update
                set((state) => {
                    const b = state.bookmarks.find(b => b.normaKey === key);
                    if (b) b.tags = tags;
                });

                // API call
                bookmarkService.update(bookmark.id, { tags }).catch(err => {
                    console.error('Failed to update bookmark tags:', err);
                });
            },

            removeBookmark: (key) => {
                const state = get();
                const bookmark = state.bookmarks.find(b => b.normaKey === key);
                if (!bookmark) return;

                // Optimistic update
                set((state) => {
                    state.bookmarks = state.bookmarks.filter(b => b.normaKey !== key);
                });

                // API call
                bookmarkService.delete(bookmark.id).catch(err => {
                    console.error('Failed to delete bookmark:', err);
                    // Rollback - re-add the bookmark
                    set((state) => {
                        state.bookmarks.push(bookmark);
                    });
                });
            },

            isBookmarked: (key) => {
                return !!get().bookmarks.find(b => b.normaKey === key);
            },

            createDossier: (title, description) => {
                const tempId = uuidv4();

                // Optimistic update
                set((state) => {
                    state.dossiers.push({
                        id: tempId,
                        title,
                        description,
                        createdAt: new Date().toISOString(),
                        items: []
                    });
                });

                // API call
                dossierService.create({
                    name: title,
                    description,
                }).then(created => {
                    // Update with server ID
                    set((state) => {
                        const dossier = state.dossiers.find(d => d.id === tempId);
                        if (dossier) {
                            dossier.id = created.id;
                        }
                    });
                }).catch(err => {
                    console.error('Failed to create dossier:', err);
                    // Rollback
                    set((state) => {
                        state.dossiers = state.dossiers.filter(d => d.id !== tempId);
                    });
                });
            },

            deleteDossier: (id) => {
                const state = get();
                const dossier = state.dossiers.find(d => d.id === id);

                // Optimistic update
                set((state) => {
                    state.dossiers = state.dossiers.filter(d => d.id !== id);
                });

                // API call
                dossierService.delete(id).catch(err => {
                    console.error('Failed to delete dossier:', err);
                    // Rollback
                    if (dossier) {
                        set((state) => {
                            state.dossiers.push(dossier);
                        });
                    }
                });
            },

            updateDossier: (id, updates) => {
                // Optimistic update
                set((state) => {
                    const dossier = state.dossiers.find(d => d.id === id);
                    if (dossier) {
                        if (updates.title !== undefined) dossier.title = updates.title;
                        if (updates.description !== undefined) dossier.description = updates.description;
                        if (updates.tags !== undefined) dossier.tags = updates.tags;
                    }
                });

                // API call
                dossierService.update(id, {
                    name: updates.title,
                    description: updates.description,
                }).catch(err => {
                    console.error('Failed to update dossier:', err);
                });
            },

            toggleDossierPin: (id) => set((state) => {
                const dossier = state.dossiers.find(d => d.id === id);
                if (dossier) {
                    dossier.isPinned = !dossier.isPinned;
                }
            }),

            addToDossier: (dossierId, itemData, type) => {
                const tempId = uuidv4();

                // Optimistic update
                set((state) => {
                    const dossier = state.dossiers.find(d => d.id === dossierId);
                    if (dossier) {
                        dossier.items.push({
                            id: tempId,
                            type,
                            data: itemData,
                            addedAt: new Date().toISOString()
                        });
                    }
                });

                // API call
                dossierService.addItem(dossierId, {
                    itemType: type === 'norma' ? 'norm' : 'note',
                    title: itemData.tipo_atto || 'Nota',
                    content: itemData,
                }).then(created => {
                    // Update with server ID
                    set((state) => {
                        const dossier = state.dossiers.find(d => d.id === dossierId);
                        const item = dossier?.items.find(i => i.id === tempId);
                        if (item) {
                            item.id = created.id;
                        }
                    });
                }).catch(err => {
                    console.error('Failed to add item to dossier:', err);
                    // Rollback
                    set((state) => {
                        const dossier = state.dossiers.find(d => d.id === dossierId);
                        if (dossier) {
                            dossier.items = dossier.items.filter(i => i.id !== tempId);
                        }
                    });
                });
            },

            removeFromDossier: (dossierId, itemId) => {
                const state = get();
                const dossier = state.dossiers.find(d => d.id === dossierId);
                const item = dossier?.items.find(i => i.id === itemId);

                // Optimistic update
                set((state) => {
                    const d = state.dossiers.find(d => d.id === dossierId);
                    if (d) {
                        d.items = d.items.filter(i => i.id !== itemId);
                    }
                });

                // API call
                dossierService.deleteItem(dossierId, itemId).catch(err => {
                    console.error('Failed to remove item from dossier:', err);
                    // Rollback
                    if (item) {
                        set((state) => {
                            const d = state.dossiers.find(d => d.id === dossierId);
                            if (d) {
                                d.items.push(item);
                            }
                        });
                    }
                });
            },

            reorderDossierItems: (dossierId, fromIndex, toIndex) => {
                const state = get();
                const dossier = state.dossiers.find(d => d.id === dossierId);
                if (!dossier || fromIndex === toIndex) return;

                // Optimistic update
                set((state) => {
                    const d = state.dossiers.find(d => d.id === dossierId);
                    if (d) {
                        const items = [...d.items];
                        const [removed] = items.splice(fromIndex, 1);
                        items.splice(toIndex, 0, removed);
                        d.items = items;
                    }
                });

                // API call - send new order
                const newOrder = [...dossier.items];
                const [removed] = newOrder.splice(fromIndex, 1);
                newOrder.splice(toIndex, 0, removed);
                const itemIds = newOrder.map(i => i.id);

                dossierService.reorderItems(dossierId, itemIds).catch(err => {
                    console.error('Failed to reorder dossier items:', err);
                });
            },

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

            importDossier: (dossier) => {
                const newId = uuidv4();
                set((state) => {
                    state.dossiers.push({
                        ...dossier,
                        id: newId,
                        createdAt: new Date().toISOString(),
                        items: dossier.items.map(item => ({
                            ...item,
                            id: uuidv4() // Generate new IDs to avoid conflicts
                        }))
                    });
                });
                return newId;
            },

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

            removeQuickNormByParams: (searchParams) => set((state) => {
                state.quickNorms = state.quickNorms.filter(
                    qn => !(qn.searchParams.act_type === searchParams.act_type &&
                        qn.searchParams.article === searchParams.article &&
                        qn.searchParams.act_number === searchParams.act_number &&
                        qn.searchParams.date === searchParams.date)
                );
            }),

            updateQuickNormLabel: (id, label) => set((state) => {
                const qn = state.quickNorms.find(q => q.id === id);
                if (qn) {
                    qn.label = label;
                }
            }),

            selectQuickNorm: (id) => {
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
            },

            isQuickNorm: (searchParams) => {
                const state = get();
                return state.quickNorms.some(
                    qn => qn.searchParams.act_type === searchParams.act_type &&
                        qn.searchParams.article === searchParams.article &&
                        qn.searchParams.act_number === searchParams.act_number &&
                        qn.searchParams.date === searchParams.date
                );
            },

            // CustomAlias Actions
            addCustomAlias: (aliasData) => {
                const state = get();
                const triggerLower = aliasData.trigger.toLowerCase().trim();

                // Validate trigger: min 2 chars, alphanumeric + dash/underscore
                if (triggerLower.length < 2 || !/^[a-zA-Z0-9\-_.]+$/.test(triggerLower)) {
                    return false;
                }

                // Check for duplicates
                const exists = state.customAliases.some(
                    a => a.trigger.toLowerCase() === triggerLower
                );

                if (exists) {
                    return false;
                }

                set((draft) => {
                    draft.customAliases.push({
                        ...aliasData,
                        id: uuidv4(),
                        trigger: triggerLower,
                        createdAt: new Date().toISOString(),
                        usageCount: 0,
                    });
                });
                return true;
            },

            updateCustomAlias: (id, updates) => set((state) => {
                const alias = state.customAliases.find(a => a.id === id);
                if (alias) {
                    if (updates.trigger) {
                        updates.trigger = updates.trigger.toLowerCase().trim();
                    }
                    Object.assign(alias, updates);
                }
            }),

            removeCustomAlias: (id) => set((state) => {
                state.customAliases = state.customAliases.filter(a => a.id !== id);
            }),

            trackAliasUsage: (id) => set((state) => {
                const alias = state.customAliases.find(a => a.id === id);
                if (alias) {
                    alias.usageCount += 1;
                    alias.lastUsedAt = new Date().toISOString();
                }
            }),

            resolveAlias: (input) => {
                const state = get();
                const inputLower = input.toLowerCase().trim();

                // Find matching user alias
                const userAlias = state.customAliases.find(
                    a => a.trigger.toLowerCase() === inputLower
                );

                if (userAlias) {
                    if (userAlias.type === 'shortcut') {
                        return {
                            found: true,
                            alias: userAlias,
                            resolvedActType: userAlias.expandTo,
                        };
                    } else {
                        // Reference type - return full search params
                        return {
                            found: true,
                            alias: userAlias,
                            resolvedActType: userAlias.searchParams?.act_type || userAlias.expandTo,
                            resolvedParams: userAlias.searchParams ? {
                                act_type: userAlias.searchParams.act_type,
                                act_number: userAlias.searchParams.act_number || '',
                                date: userAlias.searchParams.date || '',
                                article: userAlias.searchParams.article || '1',
                            } : undefined,
                        };
                    }
                }

                return { found: false };
            },

            isAliasTriggerTaken: (trigger, excludeId) => {
                const state = get();
                const triggerLower = trigger.toLowerCase().trim();
                return state.customAliases.some(
                    a => a.trigger.toLowerCase() === triggerLower && a.id !== excludeId
                );
            },

            getCustomAliasesSorted: () => {
                const state = get();
                return [...state.customAliases].sort((a, b) => {
                    // Sort by type first (shortcuts before references)
                    if (a.type !== b.type) {
                        return a.type === 'shortcut' ? -1 : 1;
                    }
                    // Then by usage count (descending)
                    if (b.usageCount !== a.usageCount) {
                        return b.usageCount - a.usageCount;
                    }
                    // Then alphabetically by trigger
                    return a.trigger.localeCompare(b.trigger);
                });
            },

            // Environment Actions
            createEnvironment: (name, options = {}) => {
                const envId = uuidv4();
                const state = get();

                set((draft) => {
                    const newEnv: Environment = {
                        id: envId,
                        name,
                        description: options.description,
                        category: options.category,
                        createdAt: new Date().toISOString(),
                        // If fromCurrent, snapshot current state
                        dossiers: options.fromCurrent ? JSON.parse(JSON.stringify(state.dossiers)) : [],
                        quickNorms: options.fromCurrent ? JSON.parse(JSON.stringify(state.quickNorms)) : [],
                        customAliases: options.fromCurrent ? JSON.parse(JSON.stringify(state.customAliases)) : [],
                        annotations: options.fromCurrent ? JSON.parse(JSON.stringify(state.annotations)) : [],
                        highlights: options.fromCurrent ? JSON.parse(JSON.stringify(state.highlights)) : [],
                        tags: [],
                    };
                    draft.environments.push(newEnv);
                });
                return envId;
            },

            createEnvironmentWithSelection: (name, selection, options = {}) => {
                const envId = uuidv4();
                const state = get();

                // Filter current state by selection
                const currentAsEnv = {
                    dossiers: state.dossiers,
                    quickNorms: state.quickNorms,
                    customAliases: state.customAliases,
                    annotations: state.annotations,
                    highlights: state.highlights,
                };
                const filtered = filterEnvironmentBySelection(currentAsEnv, selection);

                set((draft) => {
                    const newEnv: Environment = {
                        id: envId,
                        name,
                        description: options.description,
                        author: options.author,
                        version: options.version,
                        category: options.category,
                        createdAt: new Date().toISOString(),
                        dossiers: JSON.parse(JSON.stringify(filtered.dossiers || [])),
                        quickNorms: JSON.parse(JSON.stringify(filtered.quickNorms || [])),
                        customAliases: JSON.parse(JSON.stringify(filtered.customAliases || [])),
                        annotations: JSON.parse(JSON.stringify(filtered.annotations || [])),
                        highlights: JSON.parse(JSON.stringify(filtered.highlights || [])),
                        tags: [],
                    };
                    draft.environments.push(newEnv);
                });
                return envId;
            },

            updateEnvironment: (id, updates) => set((state) => {
                const env = state.environments.find(e => e.id === id);
                if (env) {
                    Object.assign(env, updates, { updatedAt: new Date().toISOString() });
                }
            }),

            deleteEnvironment: (id) => set((state) => {
                state.environments = state.environments.filter(e => e.id !== id);
            }),

            importEnvironment: (env) => {
                const newId = uuidv4();
                set((state) => {
                    // Deep clone and regenerate IDs to avoid conflicts
                    const imported: Environment = {
                        ...JSON.parse(JSON.stringify(env)),
                        id: newId,
                        createdAt: new Date().toISOString(),
                        dossiers: env.dossiers.map(d => ({ ...d, id: uuidv4(), items: d.items.map(i => ({ ...i, id: uuidv4() })) })),
                        quickNorms: env.quickNorms.map(q => ({ ...q, id: uuidv4() })),
                        annotations: env.annotations.map(a => ({ ...a, id: uuidv4() })),
                        highlights: env.highlights.map(h => ({ ...h, id: uuidv4() })),
                    };
                    state.environments.push(imported);
                });
                return newId;
            },

            importEnvironmentPartial: (envData, selection, mode) => set((state) => {
                // Filter environment by selection
                const filtered = filterEnvironmentBySelection(envData, selection);

                // Deep clone and regenerate IDs
                const clonedDossiers = JSON.parse(JSON.stringify(filtered.dossiers || [])).map((d: Dossier) => ({
                    ...d,
                    id: uuidv4(),
                    items: d.items.map((i: any) => ({ ...i, id: uuidv4() }))
                }));
                const clonedQuickNorms = JSON.parse(JSON.stringify(filtered.quickNorms || [])).map((q: QuickNorm) => ({
                    ...q,
                    id: uuidv4(),
                    usageCount: 0,
                    lastUsedAt: undefined
                }));
                const clonedCustomAliases = JSON.parse(JSON.stringify(filtered.customAliases || [])).map((a: CustomAlias) => ({
                    ...a,
                    id: uuidv4(),
                    usageCount: 0,
                    lastUsedAt: undefined
                }));
                const clonedAnnotations = JSON.parse(JSON.stringify(filtered.annotations || [])).map((a: Annotation) => ({
                    ...a,
                    id: uuidv4()
                }));
                const clonedHighlights = JSON.parse(JSON.stringify(filtered.highlights || [])).map((h: Highlight) => ({
                    ...h,
                    id: uuidv4()
                }));

                if (mode === 'replace') {
                    state.dossiers = clonedDossiers;
                    state.quickNorms = clonedQuickNorms;
                    state.customAliases = clonedCustomAliases;
                    state.annotations = clonedAnnotations;
                    state.highlights = clonedHighlights;
                } else {
                    // Merge mode: add new items, skip duplicates
                    const existingDossierTitles = new Set(state.dossiers.map(d => d.title.toLowerCase()));
                    const existingQuickNormLabels = new Set(state.quickNorms.map(q => q.label.toLowerCase()));
                    const existingAliasTriggers = new Set(state.customAliases.map(a => a.trigger.toLowerCase()));

                    clonedDossiers.forEach((d: Dossier) => {
                        if (!existingDossierTitles.has(d.title.toLowerCase())) {
                            state.dossiers.push(d);
                        }
                    });

                    clonedQuickNorms.forEach((q: QuickNorm) => {
                        if (!existingQuickNormLabels.has(q.label.toLowerCase())) {
                            state.quickNorms.push(q);
                        }
                    });

                    clonedCustomAliases.forEach((a: CustomAlias) => {
                        if (!existingAliasTriggers.has(a.trigger.toLowerCase())) {
                            state.customAliases.push(a);
                        }
                    });

                    // For annotations and highlights, add all
                    state.annotations.push(...clonedAnnotations);
                    state.highlights.push(...clonedHighlights);
                }
            }),

            applyEnvironment: (id, mode) => set((state) => {
                const env = state.environments.find(e => e.id === id);
                if (!env) return;

                // Deep clone environment content
                const clonedDossiers = JSON.parse(JSON.stringify(env.dossiers)).map((d: Dossier) => ({
                    ...d,
                    id: uuidv4(),
                    items: d.items.map((i: any) => ({ ...i, id: uuidv4() }))
                }));
                const clonedQuickNorms = JSON.parse(JSON.stringify(env.quickNorms)).map((q: QuickNorm) => ({
                    ...q,
                    id: uuidv4(),
                    usageCount: 0,
                    lastUsedAt: undefined
                }));
                const clonedCustomAliases = JSON.parse(JSON.stringify(env.customAliases || [])).map((a: CustomAlias) => ({
                    ...a,
                    id: uuidv4(),
                    usageCount: 0,
                    lastUsedAt: undefined
                }));
                const clonedAnnotations = JSON.parse(JSON.stringify(env.annotations)).map((a: Annotation) => ({
                    ...a,
                    id: uuidv4()
                }));
                const clonedHighlights = JSON.parse(JSON.stringify(env.highlights)).map((h: Highlight) => ({
                    ...h,
                    id: uuidv4()
                }));

                if (mode === 'replace') {
                    state.dossiers = clonedDossiers;
                    state.quickNorms = clonedQuickNorms;
                    state.customAliases = clonedCustomAliases;
                    state.annotations = clonedAnnotations;
                    state.highlights = clonedHighlights;
                } else {
                    // Merge mode: add new items, skip duplicates by title/label/trigger
                    const existingDossierTitles = new Set(state.dossiers.map(d => d.title.toLowerCase()));
                    const existingQuickNormLabels = new Set(state.quickNorms.map(q => q.label.toLowerCase()));
                    const existingAliasTriggers = new Set(state.customAliases.map(a => a.trigger.toLowerCase()));

                    clonedDossiers.forEach((d: Dossier) => {
                        if (!existingDossierTitles.has(d.title.toLowerCase())) {
                            state.dossiers.push(d);
                        }
                    });

                    clonedQuickNorms.forEach((q: QuickNorm) => {
                        if (!existingQuickNormLabels.has(q.label.toLowerCase())) {
                            state.quickNorms.push(q);
                        }
                    });

                    clonedCustomAliases.forEach((a: CustomAlias) => {
                        if (!existingAliasTriggers.has(a.trigger.toLowerCase())) {
                            state.customAliases.push(a);
                        }
                    });

                    // For annotations and highlights, we add all (hard to detect duplicates)
                    state.annotations.push(...clonedAnnotations);
                    state.highlights.push(...clonedHighlights);
                }
            }),

            refreshEnvironmentFromCurrent: (id) => set((state) => {
                const env = state.environments.find(e => e.id === id);
                if (env) {
                    env.dossiers = JSON.parse(JSON.stringify(state.dossiers));
                    env.quickNorms = JSON.parse(JSON.stringify(state.quickNorms));
                    env.customAliases = JSON.parse(JSON.stringify(state.customAliases));
                    env.annotations = JSON.parse(JSON.stringify(state.annotations));
                    env.highlights = JSON.parse(JSON.stringify(state.highlights));
                    env.updatedAt = new Date().toISOString();
                }
            }),

            getCurrentStateAsEnvironment: (name) => {
                const state = get();
                return {
                    id: uuidv4(),
                    name,
                    createdAt: new Date().toISOString(),
                    dossiers: JSON.parse(JSON.stringify(state.dossiers)),
                    quickNorms: JSON.parse(JSON.stringify(state.quickNorms)),
                    customAliases: JSON.parse(JSON.stringify(state.customAliases)),
                    annotations: JSON.parse(JSON.stringify(state.annotations)),
                    highlights: JSON.parse(JSON.stringify(state.highlights)),
                    tags: [],
                };
            }
        })),
        {
            name: 'visualex-storage',
            // Only persist UI state and settings, NOT user data (bookmarks, dossiers, etc.)
            // User data is fetched from API and should not be persisted locally
            partialize: (state) => ({
                settings: state.settings,
                searchPanelState: state.searchPanelState,
                workspaceTabs: state.workspaceTabs,
                highestZIndex: state.highestZIndex,
                customAliases: state.customAliases,
                // Note: We intentionally exclude bookmarks, dossiers, annotations, highlights,
                // quickNorms, environments - these are synced from the server
            }),
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

