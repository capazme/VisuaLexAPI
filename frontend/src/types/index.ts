export interface Norma {
    tipo_atto: string;
    data: string;
    numero_atto?: string;
    tipo_atto_reale?: string;  // Real act type when tipo_atto is an alias (e.g., "codice civile" -> "regio decreto")
    urn?: string;
}

// Backend returns a flattened structure for norma_data
export interface NormaVisitata {
    // Properties from Norma
    tipo_atto: string;
    data: string;
    numero_atto?: string;
    tipo_atto_reale?: string;  // Real act type when tipo_atto is an alias
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
    // Optional pre-existing tab id to merge into (used by dossier "apri tutto" so
    // multiple queued searches all land in the same pre-created tab without
    // relying on label-matching timing in processResult).
    targetTabId?: string;
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
    theme: 'light' | 'dark';
    fontSize: 'small' | 'medium' | 'large' | 'xlarge';
    fontFamily: 'sans' | 'serif' | 'mono';
    focusMode: boolean;
    splitView: boolean;
    /**
     * Study Mode reading preferences, persisted across sessions. Without
     * this slice the user had to re-pick the font size, line height, and
     * theme every time they reopened Study Mode — the values live in
     * Zustand state that gets rehydrated by the persist middleware.
     */
    studyMode: {
        fontSize: number;      // px, clamped 14–32 in the UI
        lineHeight: number;    // unitless, clamped 1.4–2.4 in the UI
        theme: 'light' | 'dark' | 'sepia';
    };
}

export interface Annotation {
    id: string;
    normaKey: string; // key to link to specific norm/article
    articleId: string;
    text: string; // Note body (user-authored content)
    createdAt: string;
    range?: string; // serialized range for highlights
    color?: 'yellow' | 'green' | 'red';
    /**
     * Text span inside the article that this note is anchored to. When
     * present, the article renderer draws a wavy underline around it and
     * clicking the span opens the note. Optional for backward compatibility:
     * notes saved before the anchor feature have no span attached and
     * remain visible only in the notes panel list.
     */
    anchorText?: string;
    /**
     * Plain-text char offset of anchorText's start in the article's DOM
     * textContent (same semantics as Highlight.startOffset).
     */
    startOffset?: number;
    sourceSuggestionId?: string | null;
    originalAuthor?: OriginalAuthor | null;
}

export interface Highlight {
    id: string;
    normaKey: string;
    articleId: string;
    rangeSerialized: string; // Simple range serialization
    text: string;
    color: 'yellow' | 'green' | 'red' | 'blue';
    /**
     * Character offset of this highlight's start in the article's *plain* text
     * (i.e. `article_text` with newlines stripped — matches DOM textContent).
     * Optional for backward compatibility with highlights saved before this
     * field existed: those fall back to global-match rendering.
     */
    startOffset?: number;
    sourceSuggestionId?: string | null;
    originalAuthor?: OriginalAuthor | null;
}

export interface Dossier {
    id: string;
    title: string;
    description?: string;
    createdAt: string;
    items: DossierItem[];
    tags?: string[];
    isPinned?: boolean;
    sourceSuggestionId?: string | null;
    originalAuthor?: OriginalAuthor | null;
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
    sourceSuggestionId?: string | null;
    originalAuthor?: OriginalAuthor | null;
}

// CustomAlias - User-defined shortcuts and references
export type AliasType = 'shortcut' | 'reference';

export interface CustomAlias {
    id: string;
    trigger: string;           // "cc", "gdpr", "mia-norma" (lowercase, alphanumeric)
    type: AliasType;
    expandTo: string;          // For shortcuts: act_type to expand to. For references: display name
    searchParams?: {           // Only for 'reference' type
        act_type: string;
        act_number?: string;
        date?: string;
        article?: string;      // Default article to load
    };
    description?: string;      // Optional user note
    createdAt: string;
    usageCount: number;
    lastUsedAt?: string;
    sourceSuggestionId?: string | null;
    originalAuthor?: OriginalAuthor | null;
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
    customAliases: CustomAlias[];
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

// ============================================
// SHARED ENVIRONMENTS (Bulletin Board)
// ============================================

export type ReportReason = 'spam' | 'inappropriate' | 'copyright' | 'other';
export type ReportStatus = 'pending' | 'reviewed' | 'dismissed';

export interface SharedEnvironmentContent {
    dossiers: Dossier[];
    quickNorms: QuickNorm[];
    customAliases: CustomAlias[];
    annotations: Annotation[];
    highlights: Highlight[];
}

export interface SharedEnvironmentUser {
    id: string;
    username: string;
}

export interface SharedEnvironment {
    id: string;
    title: string;
    description?: string;
    content: SharedEnvironmentContent;
    category: EnvironmentCategory;
    tags: string[];
    includeNotes: boolean;
    includeHighlights: boolean;

    // Metrics
    viewCount: number;
    downloadCount: number;
    likeCount: number;

    // Versioning
    currentVersion: number;
    isActive: boolean;
    replacedById?: string;

    // Suggestions count (only for owner)
    pendingSuggestionsCount?: number;

    // Author
    user: SharedEnvironmentUser;

    // Current user state
    userLiked: boolean;
    isOwner: boolean;

    createdAt: string;
    updatedAt: string;
}

export interface SharedEnvironmentListResponse {
    data: SharedEnvironment[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
    };
}

export interface PublishEnvironmentPayload {
    title: string;
    description?: string;
    content: SharedEnvironmentContent;
    category: EnvironmentCategory;
    tags?: string[];
    includeNotes?: boolean;
    includeHighlights?: boolean;
}

export interface SharedEnvironmentReport {
    id: string;
    reason: ReportReason;
    details?: string;
    status: ReportStatus;
    createdAt: string;
    environment: {
        id: string;
        title: string;
        userId: string;
    };
    reporter: SharedEnvironmentUser;
}

// ============================================
// ENVIRONMENT SUGGESTIONS & VERSIONING
// ============================================

export type SuggestionItemType = 'annotation' | 'highlight' | 'dossier' | 'quickNorm' | 'alias';
export type SuggestionItemStatus = 'pending' | 'taken' | 'declined';
export type SuggestionAggregateStatus = 'open' | 'closed' | 'revoked';

export interface OriginalAuthor {
    id: string;
    username: string;
}

export interface SuggestionItem {
    id: string;
    itemType: SuggestionItemType;
    payload: unknown; // shape depends on itemType — validated by consumers
    status: SuggestionItemStatus;
    reviewNote?: string | null;
    reviewedAt?: string | null;
    createdAt: string;
}

export interface SuggestionItemCounts {
    pending: number;
    taken: number;
    declined: number;
}

export interface EnvironmentSuggestion {
    id: string;
    sharedEnvironmentId: string;
    sharedEnvironment?: {
        id: string;
        title: string;
        user: SharedEnvironmentUser;
    };
    suggester: SharedEnvironmentUser;
    message?: string;
    items: SuggestionItem[];
    counts: SuggestionItemCounts;
    aggregateStatus: SuggestionAggregateStatus;
    createdAt: string;
    updatedAt: string;
    isOwn: boolean;
}

export interface SharedEnvironmentVersion {
    id: string;
    version: number;
    changelog?: string;
    suggestion?: {
        id: string;
        suggester: SharedEnvironmentUser;
    };
    createdAt: string;
}

export interface CreateSuggestionPayload {
    message?: string;
    items: Array<{ itemType: SuggestionItemType; payload: unknown }>;
}

export interface AddSuggestionItemsPayload {
    items: Array<{ itemType: SuggestionItemType; payload: unknown }>;
}

export interface UpdateEnvironmentWithVersionPayload {
    title?: string;
    description?: string | null;
    content?: SharedEnvironmentContent;
    category?: EnvironmentCategory;
    tags?: string[];
    changelog?: string;
    versionMode?: 'replace' | 'coexist';
}
