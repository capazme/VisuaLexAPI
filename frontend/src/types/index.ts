export interface Norma {
    tipo_atto: string;
    data: string;
    numero_atto?: string;
    urn?: string;
}

// Backend returns a flattened structure for norma_data
export interface NormaVisitata {
    // Properties from Norma
    tipo_atto: string;
    data: string;
    numero_atto?: string;
    url?: string; // Internal URL used by backend

    // Properties from NormaVisitata
    numero_articolo: string;
    versione?: string;
    data_versione?: string;
    allegato?: string;
    urn?: string; // The specific URN for this article/version
}

export interface BrocardiInfo {
    position: string | null;
    link: string | null;
    Brocardi: string[] | null;
    Ratio: string | null;
    Spiegazione: string | null;
    Massime: string[] | null;
}

export interface ArticleData {
    article_text?: string;
    url?: string;
    norma_data: NormaVisitata;
    brocardi_info?: BrocardiInfo | null;
    error?: string;
    queue_position?: number;
    versionInfo?: {
        isHistorical: boolean;
        requestedDate?: string;
        effectiveDate?: string;
    };
}

export interface SearchParams {
    act_type: string;
    act_number: string;
    date: string;
    article: string;
    version: 'vigente' | 'originale';
    version_date?: string;
    show_brocardi_info: boolean;
}

// --- New Utility Features Types ---

export interface AppSettings {
    theme: 'light' | 'dark' | 'sepia' | 'high-contrast';
    fontSize: 'small' | 'medium' | 'large' | 'xlarge';
    fontFamily: 'sans' | 'serif' | 'mono';
    focusMode: boolean;
    splitView: boolean;
}

export interface Annotation {
    id: string;
    normaKey: string; // key to link to specific norm/article
    articleId: string;
    text: string;
    createdAt: string;
    range?: string; // serialized range for highlights
    color?: 'yellow' | 'green' | 'red';
}

export interface Highlight {
    id: string;
    normaKey: string;
    articleId: string;
    rangeSerialized: string; // Simple range serialization
    text: string;
    color: 'yellow' | 'green' | 'red' | 'blue';
}

export interface Dossier {
    id: string;
    title: string;
    description?: string;
    createdAt: string;
    items: DossierItem[];
    tags?: string[];
    isPinned?: boolean;
}

export interface DossierItem {
    id: string;
    type: 'norma' | 'note';
    data: any; // NormaVisitata or Note content
    addedAt: string;
    status?: 'unread' | 'reading' | 'important' | 'done';
}

export interface Bookmark {
    id: string;
    normaKey: string;
    normaData: NormaVisitata;
    addedAt: string;
    tags: string[];
}

// QuickNorm - Favorite norms for quick access
export interface QuickNorm {
    id: string;
    label: string; // User-defined label (e.g., "Art. 2043 CC - Risarcimento")
    searchParams: SearchParams;
    sourceUrl?: string; // Optional Normattiva URL if imported from link
    createdAt: string;
    usageCount: number; // Track usage for sorting
    lastUsedAt?: string;
}
