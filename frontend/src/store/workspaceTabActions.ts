import { v4 as uuidv4 } from 'uuid';
import type { ArticleData, Norma } from '../types';

export interface NormaBlock {
    type: 'norma';
    id: string;
    norma: Norma;
    articles: ArticleData[];
    isCollapsed: boolean;
}

export interface LooseArticle {
    type: 'loose-article';
    id: string;
    article: ArticleData;
    sourceNorma: Norma;
}

export type TabContent = NormaBlock | LooseArticle;

export interface WorkspaceTab {
    id: string;
    label: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
    zIndex: number;
    isMinimized: boolean;
    content: TabContent[];
}

interface WorkspaceTabState {
    workspaceTabs: WorkspaceTab[];
    highestZIndex: number;
}

type SetWorkspaceTabState = (updater: (state: WorkspaceTabState) => void) => void;

export function createWorkspaceTabActions(set: SetWorkspaceTabState) {
    return {
        addWorkspaceTab: (label: string, norma?: Norma, articles?: ArticleData[]) => {
            let tabId = '';
            set((state) => {
                const tabCount = state.workspaceTabs.length;
                const cascade = (tabCount % 5) * 40;

                // Calculate center-ish position for new tabs
                const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
                const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
                const tabWidth = 600;
                const tabHeight = 500;
                const baseX = Math.max(50, (viewportWidth - tabWidth) / 3);
                const baseY = Math.max(50, (viewportHeight - tabHeight) / 4);

                const newTab: WorkspaceTab = {
                    id: uuidv4(),
                    label,
                    position: { x: baseX + cascade, y: baseY + cascade },
                    size: { width: tabWidth, height: tabHeight },
                    zIndex: ++state.highestZIndex,
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

        addNormaToTab: (tabId: string, norma: Norma, articles: ArticleData[]) => set((state) => {
            const tab = state.workspaceTabs.find((t: WorkspaceTab) => t.id === tabId);
            if (!tab) return;

            const existingNorma = tab.content.find(
                (c: TabContent) => c.type === 'norma' &&
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

        addLooseArticleToTab: (tabId: string, article: ArticleData, sourceNorma: Norma) => set((state) => {
            const tab = state.workspaceTabs.find((t: WorkspaceTab) => t.id === tabId);
            if (!tab) return;

            tab.content.push({
                type: 'loose-article',
                id: uuidv4(),
                article,
                sourceNorma
            });

            tab.zIndex = ++state.highestZIndex;
        }),

        updateTab: (id: string, updates: Partial<WorkspaceTab>) => set((state) => {
            const tab = state.workspaceTabs.find((t: WorkspaceTab) => t.id === id);
            if (tab) {
                Object.assign(tab, updates);
            }
        }),

        removeTab: (id: string) => set((state) => {
            state.workspaceTabs = state.workspaceTabs.filter((t: WorkspaceTab) => t.id !== id);
        }),

        bringTabToFront: (id: string) => set((state) => {
            const tab = state.workspaceTabs.find((t: WorkspaceTab) => t.id === id);
            if (tab) {
                tab.zIndex = ++state.highestZIndex;
            }
        }),

        toggleTabMinimize: (id: string) => set((state) => {
            const tab = state.workspaceTabs.find((t: WorkspaceTab) => t.id === id);
            if (tab) {
                tab.isMinimized = !tab.isMinimized;
            }
        }),

        toggleNormaCollapse: (tabId: string, normaId: string) => set((state) => {
            const tab = state.workspaceTabs.find((t: WorkspaceTab) => t.id === tabId);
            if (!tab) return;

            const norma = tab.content.find((c: TabContent) => c.type === 'norma' && c.id === normaId) as NormaBlock | undefined;
            if (norma) {
                norma.isCollapsed = !norma.isCollapsed;
            }
        }),

        setTabLabel: (id: string, label: string) => set((state) => {
            const tab = state.workspaceTabs.find((t: WorkspaceTab) => t.id === id);
            if (tab) {
                tab.label = label;
            }
        }),

        moveNormaBetweenTabs: (normaId: string, sourceTabId: string, targetTabId: string) => set((state) => {
            const sourceTab = state.workspaceTabs.find((t: WorkspaceTab) => t.id === sourceTabId);
            const targetTab = state.workspaceTabs.find((t: WorkspaceTab) => t.id === targetTabId);
            if (!sourceTab || !targetTab) return;

            const normaIndex = sourceTab.content.findIndex((c: TabContent) => c.type === 'norma' && c.id === normaId);
            if (normaIndex === -1) return;

            const norma = sourceTab.content[normaIndex];
            sourceTab.content.splice(normaIndex, 1);
            targetTab.content.push(norma);

            targetTab.zIndex = ++state.highestZIndex;
        }),

        extractArticleFromNorma: (tabId: string, normaId: string, articleId: string) => set((state) => {
            const tab = state.workspaceTabs.find((t: WorkspaceTab) => t.id === tabId);
            if (!tab) return;

            const norma = tab.content.find((c: TabContent) => c.type === 'norma' && c.id === normaId) as NormaBlock | undefined;
            if (!norma) return;

            const article = norma.articles.find(a => a.norma_data.numero_articolo === articleId);
            if (!article) return;

            norma.articles = norma.articles.filter(a => a.norma_data.numero_articolo !== articleId);

            if (norma.articles.length === 0) {
                tab.content = tab.content.filter((c: TabContent) => c.id !== normaId);
            }

            tab.content.push({
                type: 'loose-article',
                id: uuidv4(),
                article,
                sourceNorma: norma.norma
            });
        }),

        moveLooseArticleBetweenTabs: (articleId: string, sourceTabId: string, targetTabId: string) => set((state) => {
            const sourceTab = state.workspaceTabs.find((t: WorkspaceTab) => t.id === sourceTabId);
            const targetTab = state.workspaceTabs.find((t: WorkspaceTab) => t.id === targetTabId);
            if (!sourceTab || !targetTab) return;

            const articleIndex = sourceTab.content.findIndex((c: TabContent) => c.type === 'loose-article' && c.id === articleId);
            if (articleIndex === -1) return;

            const looseArticle = sourceTab.content[articleIndex];
            sourceTab.content.splice(articleIndex, 1);
            targetTab.content.push(looseArticle);

            targetTab.zIndex = ++state.highestZIndex;
        }),

        removeArticleFromNorma: (tabId: string, normaId: string, articleId: string) => set((state) => {
            const tab = state.workspaceTabs.find((t: WorkspaceTab) => t.id === tabId);
            if (!tab) return;

            const norma = tab.content.find((c: TabContent) => c.type === 'norma' && c.id === normaId) as NormaBlock | undefined;
            if (!norma) return;

            norma.articles = norma.articles.filter(a => a.norma_data.numero_articolo !== articleId);

            if (norma.articles.length === 0) {
                tab.content = tab.content.filter((c: TabContent) => c.id !== normaId);
            }

            if (tab.content.length === 0) {
                state.workspaceTabs = state.workspaceTabs.filter((t: WorkspaceTab) => t.id !== tabId);
            }
        })
    };
}
