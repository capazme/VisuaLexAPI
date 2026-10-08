import type { DossierSentenzaData } from './decisions';
export type { DossierSentenzaData } from './decisions';

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

// Glossary entry (voce del dizionario giuridico Brocardi)
export interface GlossaryEntry {
    termine: string;
    url: string;
    dizionario_id: string;
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
    // Brocardi legal-dictionary links for terms used in the article
    Glossario?: GlossaryEntry[] | null;
}

export interface ArticleData {
    article_text?: string;
    url?: string;
    norma_data: NormaVisitata;
    brocardi_info?: BrocardiInfo | null;
    /** Set by the server when Brocardi was asked and did not answer (no `brocardi_info` then). */
    brocardi_error?: string;
    error?: string;
    queue_position?: number;
    /** What the source's own page says about the text it served; absent when it cannot be read. */
    validity?: ArticleValidity;
    /**
     * What was ASKED for, not what came back: `isHistorical` is true for a date or for the
     * original text, even when the answer turns out to be the text in force. What came back is
     * `validity`.
     */
    versionInfo?: {
        isHistorical: boolean;
        requestedDate?: string;
    };
}

export type ValidityState = 'current' | 'historical' | 'not_yet' | 'abrogated';

/**
 * The window of days a Normattiva page states for the text it served (dates in
 * ISO form). The source's own statement of which version came back — never an
 * echo of the date the reader typed. It says which text was in force, not which
 * discipline governs a fact.
 */
export interface ArticleValidity {
    state: ValidityState;
    /** First day in force; null for an article that did not exist yet. */
    valid_from: string | null;
    /** Last day in force; null while the text is still in force. */
    valid_to: string | null;
    version_number: number | null;
    /** The day the act's consolidated text was last updated. */
    act_updated: string | null;
    /** Whether the window contains the requested day; null when no day was requested. */
    request_in_window: boolean | null;
}

export interface SearchFilters {
    source: 'all' | 'normattiva' | 'eurlex';
    hasBrocardi: boolean;
    onlyHistorical: boolean;
    yearFrom?: number;
    yearTo?: number;
}

export interface SearchParams {
    act_type: string;
    act_number: string;
    date: string;
    article: string;
    version: 'vigente' | 'originale';
    version_date?: string;
    show_brocardi_info: boolean;
    filters?: SearchFilters;
    annex?: string; // Optional annex number/letter (e.g., "1", "2", "A", "B")
    tabLabel?: string; // Optional custom label for the workspace tab
    // Optional pre-existing tab id to merge into (used by dossier "apri tutto" so
    // multiple queued searches all land in the same pre-created tab without
    // relying on label-matching timing in processResult).
    targetTabId?: string;
    // The workspace tab the search was started from: the tab it opens is placed beside it
    // (a norm cited in a decision opens next to the decision).
    besideTabId?: string;
}

// Annex metadata returned by tree endpoint
export interface AnnexMetadata {
    number: string | null;  // null for main text, "1"/"2"/"A" for annexes
    label: string;          // Display label (e.g., "Allegato A", "Legge di Emanazione")
    article_count: number;  // Number of articles in this annex
    article_numbers: string[];  // The annex's article numbers
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

// Norma payload stored in a dossier item. It is a NormaVisitata that may also
// carry the fetched article text when the item was filed from a loaded article.
export type DossierNormaData = NormaVisitata & { article_text?: string };

interface DossierItemBase {
    id: string;
    addedAt: string;
    status?: 'unread' | 'reading' | 'important' | 'done';
    // How the server names the item and its act (`citation`, `act_citation`), in the
    // app's citation style; null for anything but a norm, absent before the server answered.
    citation?: string | null;
    actCitation?: string | null;
    // A note about one article of the dossier as a whole (MCP second round): its id.
    aboutItemId?: string | null;
    // The connected application that wrote it (through MCP); null for the user.
    createdBy?: { clientName: string | null } | null;
}

export type DossierItem =
    | (DossierItemBase & { type: 'norma'; data: DossierNormaData })
    | (DossierItemBase & { type: 'sentenza'; data: DossierSentenzaData })
    | (DossierItemBase & { type: 'note'; data: string });

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

/** A passage of an article a discussion is attached to: the quotation, its
 *  plain-text offset when the discussion was opened, 32 chars of context each side. */
export interface ThreadPassage {
    quote: string;
    start: number;
    prefix: string;
    suffix: string;
}

export interface ArticleDiscussionComment {
    id: string;
    threadId: string;
    parentId?: string | null;
    body: string;
    isHidden: boolean;
    user: { id: string; username: string };
    createdAt: string;
    updatedAt: string;
    voteCount: number;
    userVoted: boolean;
    isOwner: boolean;
}

export interface ArticleDiscussionThread {
    id: string;
    normaKey: string;
    articleId: string;
    articleLabel?: string | null;
    version?: string | null;
    title: string;
    body: string;
    passage: ThreadPassage | null;
    articleUrn: string | null;
    textHash: string | null;
    user: { id: string; username: string };
    createdAt: string;
    updatedAt: string;
    voteCount: number;
    userVoted: boolean;
    isOwner: boolean;
    comments: ArticleDiscussionComment[];
}

export interface ArticleDiscussionPassageSummary {
    id: string;
    title: string;
    passage: ThreadPassage;
    articleUrn: string | null;
    textHash: string | null;
    commentCount: number;
    createdAt: string;
    user: { id: string; username: string };
}

export interface ArticleDiscussionResponse {
    data: ArticleDiscussionThread[];
    pagination: { page: number; limit: number; total: number; pages: number };
}
