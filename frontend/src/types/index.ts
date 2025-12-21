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

// Structured massima from jurisprudence
export interface MassimaStructured {
    autorita: string | null;  // "Cass. civ.", "Corte cost.", etc.
    numero: string | null;    // "123"
    anno: string | null;      // "2021"
    massima: string;          // Cleaned text content
}

// Article cited in relazioni
export interface ArticoloCitato {
    numero: string;
    titolo: string;
    url: string;
}

// Historical relazione (Guardasigilli)
export interface RelazioneContent {
    tipo: string;             // "libro_obbligazioni" | "codice_civile"
    titolo: string;
    numero_paragrafo: string | null;
    testo: string;
    articoli_citati: ArticoloCitato[];
}

// Relazione for Constitution
export interface RelazioneCostituzione {
    titolo: string;
    autore: string;
    anno: number;
    testo: string;
}

// Footnote (nota a piè di pagina)
export interface Footnote {
    numero: number;
    testo: string;
    tipo: 'nota' | 'riferimento' | 'footnote';
}

// Related Article (articolo precedente/successivo)
export interface RelatedArticle {
    numero: string;
    url: string;
    titolo?: string;
}

export interface RelatedArticles {
    previous?: RelatedArticle;
    next?: RelatedArticle;
}

// Cross Reference (riferimento incrociato)
export interface CrossReference {
    articolo: string;
    tipo_atto?: string;
    url: string;
    sezione: 'brocardi' | 'ratio' | 'spiegazione' | 'massime';
    testo?: string;
}

export interface BrocardiInfo {
    position: string | null;
    link: string | null;
    Brocardi: string[] | null;
    Ratio: string | null;
    Spiegazione: string | null;
    // Massime: supports both legacy string[] and new structured format
    Massime: (string | MassimaStructured)[] | null;
    // Historical relations (Guardasigilli)
    Relazioni?: RelazioneContent[] | null;
    // Constitution relation (Meuccio Ruini)
    RelazioneCostituzione?: RelazioneCostituzione | null;
    // Footnotes (note a piè di pagina)
    Footnotes?: Footnote[] | null;
    // Related Articles (articoli correlati)
    RelatedArticles?: RelatedArticles | null;
    // Cross References (riferimenti incrociati)
    CrossReferences?: CrossReference[] | null;
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
    annex?: string; // Optional annex number/letter (e.g., "1", "2", "A", "B")
    tabLabel?: string; // Optional custom label for the workspace tab
}

// Annex metadata returned by tree endpoint
export interface AnnexMetadata {
    number: string | null;  // null for main text, "1"/"2"/"A" for annexes
    label: string;          // Display label (e.g., "Allegato A", "Legge di Emanazione")
    article_count: number;  // Number of articles in this annex
    article_numbers: string[];  // List of article numbers (limited to first 50)
}

export interface TreeMetadata {
    annexes?: AnnexMetadata[];  // List of annexes detected in the document
}

// Tree node for nested document structure
export interface TreeNode {
    numero?: string;
    label?: string;
    title?: string;
    name?: string;
    children?: TreeNode[];
    items?: TreeNode[];
    articoli?: TreeNode[];
}

export interface ArticleTreeResponse {
    articles: (string | TreeNode | Record<string, string>)[];  // Mixed format
    count: number;
    metadata?: TreeMetadata;  // Optional annex metadata
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

// Environment - Bundled configuration for sharing
export type EnvironmentCategory = 'compliance' | 'civil' | 'penal' | 'administrative' | 'eu' | 'other';

export interface Environment {
    id: string;
    name: string;
    description?: string;
    author?: string;
    version?: string;
    createdAt: string;
    updatedAt?: string;

    // Content (snapshots)
    dossiers: Dossier[];
    quickNorms: QuickNorm[];
    annotations: Annotation[];
    highlights: Highlight[];

    // Metadata
    tags?: string[];
    category?: EnvironmentCategory;
    color?: string; // Hex color for UI distinction
}

// Export format for environments (versioned for compatibility)
export interface EnvironmentExport {
    version: number;
    type: 'environment';
    exportedAt: string;
    data: Environment;
}
